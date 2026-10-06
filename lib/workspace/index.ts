import { randomUUID } from "node:crypto";
import type { Db } from "@/lib/db";
import { formatDate, formatPeriod, periodBounds } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { incomeStatement, trialBalance } from "@/lib/reports/ledger";
import { closeReadiness, runControls } from "@/lib/controls";
import { setupProgress } from "@/lib/setup-progress";
import { askEvidence } from "@/lib/evidence/answers";
import { completenessMatrix } from "@/lib/controls/completeness";

export type WorkspaceInput = { scope?: string; period?: string };
export class WorkspaceInputError extends Error {}

export function parseWorkspacePeriod(value: string) {
  if (!/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(value)) throw new WorkspaceInputError("Pilih periode yang valid (YYYY-MM, tahun 1900–2199).");
  return { year: Number(value.slice(0, 4)), month: Number(value.slice(5)) };
}

/** Only ids owned by the authenticated firm may reach accounting read helpers. */
export async function resolveWorkspaceScope(db: Db, firmId: string, input: WorkspaceInput = {}) {
  const clients = await db.client.findMany({ where: { firmId }, select: { id: true, name: true, entities: { where: { firmId }, select: { id: true, name: true, shortName: true, functionalCurrency: true, clientId: true, kind: true }, orderBy: { name: "asc" } } }, orderBy: { name: "asc" } });
  for (const client of clients) client.entities.sort((a, b) => Number(a.kind === "PERORANGAN") - Number(b.kind === "PERORANGAN"));
  const key = input.scope ?? "all";
  const allEntities = clients.flatMap(c => c.entities);
  const kind = key === "all" ? "all" : key.startsWith("client:") ? "client" : key.startsWith("entity:") ? "entity" : null;
  const client = kind === "client" ? clients.find(c => c.id === key.slice(7)) : undefined;
  const entity = kind === "entity" ? allEntities.find(e => e.id === key.slice(7)) : undefined;
  if (!kind || (kind === "client" && !client) || (kind === "entity" && !entity)) throw new WorkspaceInputError("Cakupan tidak ditemukan dalam kantor Anda.");
  const entities = kind === "entity" ? [entity!] : kind === "client" ? client!.entities : allEntities;
  const clientIds = kind === "client" ? [client!.id] : kind === "entity" ? [entity!.clientId] : clients.map(c => c.id);
  const entityIds = entities.map(e => e.id);
  const latest = input.period ? null : await db.journalEntry.findFirst({ where: { firmId, entityId: { in: entityIds }, kind: { not: "OPENING" } }, orderBy: { date: "desc" }, select: { date: true } });
  const period = input.period ?? (latest?.date ?? new Date()).toISOString().slice(0, 7);
  const { year, month } = parseWorkspacePeriod(period);
  // The current month in WIB, computed once on the server so every render lists the same periods.
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 7);
  return { key, kind, label: entity?.name ?? client?.name ?? "Semua klien", period, periodLabel: formatPeriod(year, month), today, year, month, clientIds, entityIds, clients, entities };
}
export type WorkspaceScope = Awaited<ReturnType<typeof resolveWorkspaceScope>>;

export function workspaceHref(path: string, scope: Pick<WorkspaceScope, "key" | "period">, extra: Record<string, string> = {}) {
  const [withoutHash, hash] = path.split("#");
  const [base, query] = withoutHash.split("?");
  const params = new URLSearchParams(query);
  params.set("scope", scope.key); params.set("period", scope.period);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  return `${base}?${params}${hash ? `#${hash}` : ""}`;
}

export type WorkspaceTask = { id: string; title: string; detail: string; href: string; priority: "high" | "normal"; clientId: string; entityId?: string };

export async function getWorkspaceOverview(db: Db, firmId: string, input: WorkspaceInput = {}) {
  const scope = await resolveWorkspaceScope(db, firmId, input);
  const { start, end } = periodBounds(scope.year, scope.month);
  const entities = await Promise.all(scope.entities.map(async e => {
    const [entries, history, openReview, pl, tb] = await Promise.all([
      db.journalEntry.count({ where: { firmId, entityId: e.id, date: { gte: start, lte: end } } }),
      db.journalEntry.count({ where: { firmId, entityId: e.id, date: { lte: end } } }),
      db.bankTransaction.count({ where: { firmId, bankAccount: { entityId: e.id }, status: "NEEDS_REVIEW", date: { lte: end } } }),
      incomeStatement(db, { clientId: e.clientId, entityIds: [e.id] }, start, end),
      trialBalance(db, { clientId: e.clientId, entityIds: [e.id] }, end),
    ]);
    const cash = tb.filter(r => r.account.fsLine === "KAS_SETARA_KAS" && r.account.type === "ASET").reduce((sum, r) => sum + r.net, 0n);
    const fmt = (v: bigint | null) => v === null ? "Belum ada jurnal" : formatMoney(v, e.functionalCurrency);
    const revenue = entries ? pl.totals.revenue : null, profit = entries ? pl.totals.netProfit : null;
    const cashValue = history ? cash : null;
    const extra = { entity: e.id };
    return { id: e.id, name: e.name, shortName: e.shortName, clientId: e.clientId, clientName: scope.clients.find(c => c.id === e.clientId)!.name, currency: e.functionalCurrency, hasActivity: entries > 0, hasBooks: history > 0, revenue: revenue?.toString() ?? null, profit: profit?.toString() ?? null, cash: cashValue?.toString() ?? null, revenueFormatted: fmt(revenue), profitFormatted: fmt(profit), cashFormatted: fmt(cashValue), openReview,
      reportHref: workspaceHref(`/clients/${e.clientId}/reports`, scope, extra), reviewHref: workspaceHref(`/clients/${e.clientId}/review`, scope, extra), closeHref: workspaceHref(`/clients/${e.clientId}/close`, scope) };
  }));
  // Close is a client/group operation. Never imply that an entity-only filter changes its controls.
  const clients = await Promise.all(scope.clients.filter(c => scope.clientIds.includes(c.id)).map(async c => {
    const [controls, period, activity, completeness] = await Promise.all([
      runControls(db, c.id, scope.year, scope.month),
      db.period.findUnique({ where: { clientId_year_month: { clientId: c.id, year: scope.year, month: scope.month } }, include: { signoffs: true } }),
      db.journalEntry.count({ where: { firmId, entity: { clientId: c.id }, date: { gte: start, lte: end } } }),
      completenessMatrix(db, c.id, scope.year, scope.month, 1),
    ]);
    // Papan kantor (I5a): Sumber is this month's completeness; Terkirim the first report out after the lock (as in close:timeline).
    const sumber = { rows: completeness.rows.length, gaps: completeness.rows.filter((r) => r.cells.some((cell) => cell.state === "missing" || cell.state === "broken")).length };
    const sent = period?.status === "LOCKED" && period.lockedAt
      ? await db.auditEvent.findFirst({ where: { clientId: c.id, kind: "REPORT_EXPORT", subject: `period:${scope.period}`, createdAt: { gte: period.lockedAt } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } })
      : null;
    const readiness = closeReadiness(controls, period?.signoffs.map(s => s.key) ?? []);
    // A failed control outranks "no journal this month": a client with nothing booked can still have broken books.
    const state = period?.status === "LOCKED" ? "LOCKED" : readiness.fails.length ? "FAIL" : !activity ? "EMPTY" : readiness.ready ? "READY" : "REVIEW";
    const labels = { LOCKED: "Buku ditutup", EMPTY: "Belum ada jurnal bulan ini", FAIL: "Kontrol gagal", READY: "Siap tutup buku", REVIEW: "Perlu dicek" };
    const missingStatements = controls.filter(control => control.key.startsWith("bank:") && control.detail.includes("belum diimpor")).map(control => ({ title: control.title, detail: `${control.scope} · ${control.detail}`, href: workspaceHref(control.href ?? `/clients/${c.id}/import`, scope) }));
    const setup = await setupProgress(db, c.id, { period: { year: scope.year, month: scope.month }, missingStatements: missingStatements.map(m => m.title) });
    return { id: c.id, name: c.name, state, label: labels[state], sumber, sentAt: sent?.createdAt ?? null, importHref: workspaceHref(`/clients/${c.id}/import`, scope), reviewHref: workspaceHref(`/clients/${c.id}/review`, scope), hasActivity: activity > 0, openReview: entities.filter(e => e.clientId === c.id).reduce((n, e) => n + e.openReview, 0), failCount: readiness.fails.length, reviewCount: readiness.unacked.length, missingSignoffs: readiness.missing.length, missingStatements, setup: { step: setup.current, hasData: setup.hasData, hasBanks: setup.hasBanks, next: setup.next, opening: setup.needsOpening.map(e => e.shortName) }, closeHref: workspaceHref(`/clients/${c.id}/close`, scope) };
  }));
  // The detail names the client when the company's own name doesn't (an owner "Budi Santoso" can belong to two clients).
  const tasks: WorkspaceTask[] = entities.filter(e => e.openReview > 0).map(e => ({ id: `review:${e.id}`, title: `Periksa ${e.openReview} transaksi`, detail: `${e.name === e.clientName ? e.name : `${e.clientName} · ${e.name}`} · sampai ${scope.periodLabel}`, href: e.reviewHref, priority: "high", clientId: e.clientId, entityId: e.id }));
  for (const c of clients) {
    if (c.state === "LOCKED") continue;
    // A client still in setup gets ONE task naming the step (upload, then Saldo Awal), instead of generic "lengkapi" tasks.
    if (c.setup.step === "import" && !c.setup.hasData && c.setup.next) { tasks.push({ id: `setup:${c.id}`, title: c.setup.hasBanks ? `Mulai ${c.name}: unggah rekening koran` : `Mulai ${c.name}: impor buku besar`, detail: c.setup.hasBanks ? "Langkah 1 dari 4 · dari sini Saldo Awal terisi otomatis" : "Langkah 1 dari 4", href: workspaceHref(c.setup.next.href, scope), priority: "normal", clientId: c.id }); continue; }
    if (c.setup.step === "opening" && c.setup.next) { tasks.push({ id: `opening:${c.id}`, title: `Isi saldo awal ${c.setup.opening.join(" dan ")}`, detail: `${c.name} · langkah 2 dari 4, saldo bank sudah terisi dari rekening koran`, href: workspaceHref(c.setup.next.href, scope), priority: "normal", clientId: c.id }); continue; }
    if (c.missingStatements.length) tasks.push({ id: `statement:${c.id}`, title: `Lengkapi ${c.missingStatements.length} rekening koran`, detail: `${c.name} · ${c.missingStatements.map(item => item.detail).join("; ")}`, href: c.missingStatements[0].href, priority: "high", clientId: c.id });
    if (c.state === "EMPTY") tasks.push({ id: `import:${c.id}`, title: "Lengkapi buku bulan ini", detail: c.name, href: workspaceHref(`/clients/${c.id}/import`, scope, scope.kind === "entity" ? { entity: scope.entityIds[0] } : {}), priority: "normal", clientId: c.id });
    else tasks.push({ id: `close:${c.id}`, title: c.failCount ? `Perbaiki ${c.failCount} kontrol gagal` : c.reviewCount ? `Periksa ${c.reviewCount} temuan tutup buku` : c.missingSignoffs ? `Lengkapi ${c.missingSignoffs} pemeriksaan akhir` : "Tutup buku", detail: `${c.name} · seluruh grup/klien`, href: c.closeHref, priority: c.failCount ? "high" : "normal", clientId: c.id });
  }
  // What blocks the books first: failed controls, then missing statements (review of what isn't imported can't finish), then review.
  const rank = (t: WorkspaceTask) => (t.priority !== "high" ? 3 : t.id.startsWith("close:") ? 0 : t.id.startsWith("statement:") ? 1 : 2);
  tasks.sort((a, b) => rank(a) - rank(b));
  return { scope, entities, clients, tasks, counts: { entities: entities.length, openReview: entities.reduce((n, e) => n + e.openReview, 0), closed: clients.filter(c => c.state === "LOCKED").length, clients: clients.length } };
}
export type WorkspaceOverview = Awaited<ReturnType<typeof getWorkspaceOverview>>;
export type WorkspaceAnswer = {
  id: string;
  question: string;
  scope: Pick<WorkspaceScope, "key" | "label" | "period" | "periodLabel">;
  text: string;
  rows: { label: string; value: string; source: string }[];
  citations: { label: string; href: string }[];
  limitations: string[];
  /** Numbers of a month not closed yet are preliminary (use-case feedback UC-X5): which month, for which clients. Null when closed or not from the books. */
  preliminary: string | null;
};

/** Asking Buku to change something (it only reads): an instruction verb at the start, politely or not. */
const CHANGE_REQUEST = /^\s*(?:tolong|mohon|bisa(?:kah)?|coba|please)?\s*(?:ubah|ubahkan|ganti|hapus|hapuskan|edit|koreksi|koreksikan|catat|catatkan|posting|postingkan|jurnalkan|reklas|reklasifikasi(?:kan)?|pindahkan|kunci|buka kembali|unlock|delete|change)\b/i;

export function workspaceQuestionIntent(question: string) {
  const q = question.toLowerCase();
  // "Koreksi fiskal berapa?" asks about a number; "Koreksi akun transaksi ini ke 6100" asks Buku to act.
  if (CHANGE_REQUEST.test(question) && !/\b(berapa|apa|apakah|siapa|mana|bagaimana|kenapa|mengapa|kapan)\b|\?\s*$/.test(q)) return "change";
  if (/\b(prediksi|forecast|proyeksi|ramalan|tahun depan|bulan depan)\b/.test(q)) return "unsupported";
  // "Transaksi apa yang belum jelas / perlu ditanyakan ke klien?": rows still waiting in Review (before the payee search reads "klien" as a name).
  if (/belum jelas|(perlu|harus|mau) (di)?tanya|ditanyakan|tanya(kan)? (ke )?klien|pertanyaan (untuk|ke|buat) klien|konfirmasi (ke )?klien|belum (di)?klasifikasi|menunggu review/.test(q)) return "unclear";
  if (/\b(tutup buku|close|kesiapan|siap|hambatan|penghambat)\b/.test(q)) return "readiness";
  // "transfer ke ALFI YANDRA", "pembayaran dari DINA", "mutasi dengan \"PT PAKAN\"": bank lines by counterparty.
  if (/\b(transfer|transaksi|mutasi|pembayaran|bayar|dibayar|penerimaan|terima|diterima|kiriman|dikirim|setoran)\b/.test(q) && counterpartyOf(question)) return "transactions";
  if (/\b(profil|profile|usaha|industry|industri|konteks)\b/.test(q)) return "context";
  if (/\b(dokumen|file|sumber|rekening koran|laporan unggahan)\b/.test(q)) return "evidence";
  if (/\b(laba|profit|pendapatan|revenue)\b/.test(q)) return "profit";
  if (/\b(saldo|kas|bank|balance)\b/.test(q)) return "balances";
  return "unsupported";
}

/** "Sementara: Agustus 2026 belum ditutup (untuk …)" when any client in scope has the month open; null when all closed it. */
async function preliminaryLabel(db: Db, scope: WorkspaceScope) {
  const locked = await db.period.findMany({ where: { clientId: { in: scope.clientIds }, year: scope.year, month: scope.month, status: "LOCKED" }, select: { clientId: true } });
  const open = scope.clients.filter((c) => scope.clientIds.includes(c.id) && !locked.some((l) => l.clientId === c.id));
  if (!open.length) return null;
  const who = open.length === scope.clientIds.length ? "" : ` untuk ${open.map((c) => c.name).join(", ")}`;
  return `Sementara: ${scope.periodLabel} belum ditutup${who}. Angka bisa berubah sampai buku ditutup.`;
}

const PHRASE_END = /\s+(?:bulan|tahun|dan|di|yang|pada|sampai|dicatat|masuk|keluar|periode|berapa|total|ke akun|di akun)\b|[?.,;:!]|$/i;
/** The counterparty named in a question: a quoted phrase, else the words after ke/dari/kepada/untuk/oleh/dengan. */
export function counterpartyOf(question: string): string | null {
  const quoted = question.match(/["“']([^"”']{3,60})["”']/)?.[1];
  if (quoted) return quoted.trim();
  const m = question.match(/\b(?:ke|dari|kepada|untuk|oleh|dengan)\s+([\p{L}][\p{L}\p{N} .&'-]{2,60})/iu);
  if (!m) return null;
  const name = m[1].split(PHRASE_END)[0].trim();
  // "ke akun apa", "dari bank" name no one.
  if (!name || /^(akun|rekening|bank|mana|siapa|apa)\b/i.test(name) || name.replace(/[^\p{L}]/gu, "").length < 3) return null;
  return name;
}

export async function askWorkspace(db: Db, firmId: string, input: WorkspaceInput & { question: string }): Promise<WorkspaceAnswer> {
  const question = input.question.trim();
  if (!question || question.length > 2000) throw new WorkspaceInputError("Tulis pertanyaan antara 1 dan 2.000 karakter.");
  const resolved = await resolveWorkspaceScope(db, firmId, input);
  const { key, label, period, periodLabel } = resolved;
  const answer: WorkspaceAnswer = { id: randomUUID(), question, scope: { key, label, period, periodLabel }, text: "", rows: [], citations: [], limitations: [], preliminary: null };
  const intent = workspaceQuestionIntent(question);
  const accountCode = question.match(/\b(?:akun|account)\s+([0-9][a-z0-9.-]{0,29})\b/i)?.[1];
  if (intent === "change") {
    answer.text = "Tanya Buku hanya membaca buku, tidak mengubahnya. Lakukan perubahan di halamannya agar tercatat dengan nama Anda: klasifikasi di Review atau di buku besar (Ubah akun), jurnal di Jurnal Penyesuaian, saldo awal di Saldo Awal, temuan dan penutupan di Tutup Buku.";
    return answer;
  }
  if (intent !== "context" && intent !== "evidence" && intent !== "unsupported") answer.preliminary = await preliminaryLabel(db, resolved);
  if (intent === "unsupported") {
    answer.text = "Pertanyaan ini belum didukung. Coba kesiapan tutup buku, laba, saldo kas, transfer ke/dari nama tertentu, transaksi yang perlu ditanyakan ke klien, profil perusahaan, atau pencarian dokumen.";
    return answer;
  }
  if (intent === "unclear") {
    // Deterministic: bank lines still in Review (1999) up to the month's end, largest amount first (UC-B3) — the list to ask the client about.
    const { end } = periodBounds(resolved.year, resolved.month);
    const lines = await db.bankTransaction.findMany({
      where: { firmId, entityId: { in: resolved.entityIds }, status: "NEEDS_REVIEW", date: { lte: end } },
      include: { bankAccount: { include: { entity: true } } },
      orderBy: [{ date: "asc" }, { rowNumber: "asc" }],
    });
    const size = (v: bigint) => (v < 0n ? -v : v);
    lines.sort((x, y) => (size(y.amount) > size(x.amount) ? 1 : size(y.amount) < size(x.amount) ? -1 : 0));
    const names = new Map((await db.account.findMany({ where: { clientId: { in: resolved.clientIds } }, select: { clientId: true, code: true, name: true } })).map((a) => [`${a.clientId}|${a.code}`, a.name]));
    const totals = new Map<string, { inn: bigint; out: bigint }>();
    for (const t of lines) {
      const sum = totals.get(t.bankAccount.currency) ?? { inn: 0n, out: 0n };
      if (t.amount > 0n) sum.inn += t.amount;
      else sum.out += -t.amount;
      totals.set(t.bankAccount.currency, sum);
    }
    const total = [...totals].map(([cur, v]) => [v.inn ? `masuk ${formatMoney(v.inn, cur)}` : "", v.out ? `keluar ${formatMoney(v.out, cur)}` : ""].filter(Boolean).join(", ")).join("; ");
    answer.text = lines.length
      ? `${lines.length} transaksi belum jelas sampai ${periodLabel} (${total}). Tanyakan ke klien dari siapa uang masuk dan untuk apa uang keluar, lalu pilih akunnya di Review.`
      : `Tidak ada transaksi yang menunggu review sampai ${periodLabel} di cakupan ini.`;
    for (const t of lines.slice(0, 30)) {
      const clientId = t.bankAccount.entity.clientId;
      const href = workspaceHref(`/clients/${clientId}/review`, resolved, { entity: t.entityId });
      const amount = t.amount < 0n ? -t.amount : t.amount;
      const guess = t.suggestedCode ? `usulan ${t.suggestedCode} ${names.get(`${clientId}|${t.suggestedCode}`) ?? ""}`.trim() : "tanpa usulan";
      answer.rows.push({
        label: `${formatDate(t.date)} · ${t.bankAccount.entity.shortName} · ${t.bankAccount.label} · ${t.description.slice(0, 80)}`,
        value: `${t.amount > 0n ? "Masuk" : "Keluar"} ${formatMoney(amount, t.bankAccount.currency)} · ${guess}`,
        source: href,
      });
    }
    const entities = [...new Map(lines.map((t) => [t.entityId, t.bankAccount.entity])).values()];
    for (const e of entities) answer.citations.push({ label: `${e.shortName} · Review transaksi`, href: workspaceHref(`/clients/${e.clientId}/review`, resolved, { entity: e.id }) });
    if (lines.length > 30) answer.limitations.push(`Menampilkan 30 dari ${lines.length} transaksi, dari nominal terbesar; totalnya dari semua. Daftar lengkapnya bisa diunduh di Review.`);
    answer.limitations.push("Dari mutasi bank yang masih di Review (1999). Transaksi yang sudah diterima dengan tebakan ada di kontrol Tutup Buku.");
    return answer;
  }
  if (intent === "transactions") {
    // Deterministic: bank lines of the scope's entities in the month whose description holds every word of the name.
    const who = counterpartyOf(question)!;
    const words = who.split(/\s+/).filter((w) => w.length >= 2).slice(0, 6);
    const { start, end } = periodBounds(resolved.year, resolved.month);
    const lines = await db.bankTransaction.findMany({
      where: { firmId, entityId: { in: resolved.entityIds }, date: { gte: start, lte: end }, AND: words.map((w) => ({ description: { contains: w, mode: "insensitive" as const } })) },
      include: { bankAccount: { include: { entity: true } } },
      orderBy: [{ date: "asc" }, { rowNumber: "asc" }],
      take: 201,
    });
    const shown = lines.slice(0, 200);
    const names = new Map((await db.account.findMany({ where: { clientId: { in: resolved.clientIds } }, select: { clientId: true, code: true, name: true } })).map((a) => [`${a.clientId}|${a.code}`, a.name]));
    const byCurrency = new Map<string, { inn: bigint; out: bigint }>();
    const byAccount = new Map<string, number>();
    for (const t of shown) {
      const cur = t.bankAccount.currency;
      const sum = byCurrency.get(cur) ?? { inn: 0n, out: 0n };
      if (t.amount > 0n) sum.inn += t.amount;
      else sum.out += -t.amount;
      byCurrency.set(cur, sum);
      const code = t.status === "NEEDS_REVIEW" ? "1999" : (t.accountCode ?? "1999");
      byAccount.set(code, (byAccount.get(code) ?? 0) + 1);
    }
    const totals = [...byCurrency].map(([cur, v]) => [v.inn ? `masuk ${formatMoney(v.inn, cur)}` : "", v.out ? `keluar ${formatMoney(v.out, cur)}` : ""].filter(Boolean).join(", ")).join("; ");
    const accounts = [...byAccount].sort((a, b) => b[1] - a[1]).map(([code, n]) => `${code} (${n}×)`).join(", ");
    answer.text = shown.length
      ? `${shown.length} mutasi bank dengan "${who}" pada ${periodLabel}: ${totals}. Dicatat ke ${accounts}.`
      : `Tidak ada mutasi bank dengan "${who}" pada ${periodLabel} di cakupan ini.`;
    for (const t of shown.slice(0, 30)) {
      const clientId = t.bankAccount.entity.clientId;
      const waiting = t.status === "NEEDS_REVIEW";
      const code = waiting ? "1999" : (t.accountCode ?? "1999");
      const href = workspaceHref(`/clients/${clientId}/ledger/${encodeURIComponent(code)}`, resolved, { entity: t.entityId });
      const amount = t.amount < 0n ? -t.amount : t.amount;
      answer.rows.push({
        label: `${formatDate(t.date)} · ${t.bankAccount.entity.shortName} · ${t.bankAccount.label} · ${t.description.slice(0, 80)}`,
        value: `${t.amount > 0n ? "Masuk" : "Keluar"} ${formatMoney(amount, t.bankAccount.currency)} → ${waiting ? `menunggu review (usulan ${t.suggestedCode ?? "-"})` : `${code} ${names.get(`${clientId}|${code}`) ?? ""}`.trim()}`,
        source: href,
      });
      answer.citations.push({ label: `${t.bankAccount.entity.shortName} · buku besar ${code}`, href });
    }
    if (lines.length > 200) answer.limitations.push("Lebih dari 200 mutasi cocok; total dihitung dari 200 pertama. Persempit namanya atau pilih perusahaan.");
    if (shown.length > 30) answer.limitations.push(`Menampilkan 30 dari ${shown.length} mutasi; totalnya dari semua yang cocok.`);
    answer.limitations.push("Dicari dari keterangan rekening koran pada bulan terpilih; jurnal penyesuaian dan buku besar impor tidak ikut dihitung.");
  } else if (intent === "context" || intent === "evidence") {
    // Intake client ownership plus confirmed entity/period selections restrict source passages.
    const intakes = await db.evidenceIntake.findMany({ where: { firmId, clientId: { in: resolved.clientIds } }, orderBy: { id: "asc" }, take: 11 });
    for (const intake of intakes.slice(0, 10)) {
      const searchQuestion = `Cari dokumen ${question.replace(/banding\w*|compare|perbandingan|kurang|missing|belum lengkap|rekonsiliasi|selisih|control|kontrol|kenapa saldo|profil|company|perusahaan|usaha|fiskal/gi, "")}`.slice(0, 2000);
      const result = await askEvidence(db, firmId, intake.id, { question: intent === "context" ? "Profil perusahaan" : searchQuestion, ...(intent === "context" ? {} : { period }), ...(resolved.kind === "entity" ? { entityId: resolved.entityIds[0] } : {}) }, null);
      answer.rows.push(...(result.rows ?? []).slice(0, Math.max(0, 30 - answer.rows.length)).map(r => ({ ...r, label: `${intake.name} · ${r.label}` })));
      answer.citations.push(...result.citations.map(c => ({ label: `${c.label} · ${c.locator}`, href: workspaceHref(`/documents/source/${encodeURIComponent(c.versionId)}#cited-source`, resolved, { at: c.locator, answer: answer.id }) })));
      answer.limitations.push(...result.limitations);
      if (answer.rows.length >= 30) break;
    }
    answer.text = answer.rows.length ? intent === "context" ? "Konteks perusahaan beserta status konfirmasi dan sumbernya." : "Bukti dokumen pada cakupan terpilih. Angka dari sumber belum merupakan saldo buku Buku." : intent === "context" ? "Belum ada konteks perusahaan untuk cakupan terpilih." : "Belum ada bukti dokumen dengan cakupan perusahaan dan periode yang sesuai.";
    if (intakes.length > 10 || answer.rows.length >= 30) answer.limitations.push("Hasil dibatasi 10 kumpulan dan 30 baris; pilih klien atau perusahaan untuk mempersempit pencarian.");
    answer.limitations.push(intent === "context" ? "Profil perusahaan memakai konteks yang tersedia, termasuk tanpa tanggal; ini bukan posisi historis pada bulan terpilih. Dokumen tanpa klien tidak disertakan." : "Dokumen tanpa klien atau periode yang sesuai tidak disertakan. Periksa cakupan dokumen di Dokumen.");
  } else {
    const data = await getWorkspaceOverview(db, firmId, { scope: key, period });
    if (intent === "readiness") {
      answer.text = `Kesiapan tutup buku untuk ${periodLabel}. Penutupan berlaku untuk seluruh grup/klien.`;
      for (const c of data.clients) {
        answer.rows.push({ label: c.name, value: `${c.label} · ${c.failCount} kontrol gagal · ${c.reviewCount} temuan belum diakui · ${c.missingSignoffs} pemeriksaan akhir`, source: c.closeHref });
        answer.citations.push({ label: `${c.name} · kontrol tutup buku`, href: c.closeHref });
      }
      if (resolved.kind === "entity") answer.limitations.push("Kesiapan mencakup seluruh klien induk, termasuk perusahaan lain di dalamnya.");
    } else {
      answer.text = intent === "profit" ? `Laba dan pendapatan ${periodLabel}, dihitung dari jurnal Buku.` : accountCode ? `Saldo akun ${accountCode} pada akhir ${periodLabel}, dihitung dari jurnal Buku.` : `Saldo kas dan bank aset pada akhir ${periodLabel}, dihitung dari jurnal Buku.`;
      for (const e of data.entities) {
        if (intent === "balances" && accountCode) {
          const tb = await trialBalance(db, { clientId: e.clientId, entityIds: [e.id] }, periodBounds(resolved.year, resolved.month).end);
          const row = tb.find(r => r.account.code === accountCode);
          const href = workspaceHref(`/clients/${e.clientId}/ledger/${encodeURIComponent(accountCode)}`, resolved, { entity: e.id });
          answer.rows.push({ label: `${e.name} · ${accountCode}${row ? ` ${row.account.name}` : ""}`, value: !row ? "Akun tidak ditemukan" : !e.hasBooks ? "Belum ada jurnal" : `${formatMoney(row.net < 0n ? -row.net : row.net, e.currency)} ${row.net < 0n ? "Kredit" : "Debit"}`, source: row ? href : e.reportHref });
          if (row) answer.citations.push({ label: `${e.name} · buku besar ${accountCode}`, href });
          continue;
        }
        const href = intent === "profit" ? e.reportHref : workspaceHref(`/clients/${e.clientId}/trial-balance`, resolved, { entity: e.id });
        answer.rows.push({ label: `${e.name} · ${e.currency}`, value: intent === "profit" ? `Pendapatan ${e.revenueFormatted}; laba bersih ${e.profitFormatted}` : e.cashFormatted, source: href });
        answer.citations.push({ label: `${e.name} · ${intent === "profit" ? "laporan dari buku besar" : "neraca saldo"}`, href });
      }
      answer.limitations.push("Setiap perusahaan dalam mata uangnya sendiri; perbandingan ini bukan konsolidasi. Dokumen laporan unggahan tidak dihitung sebagai jurnal.");
      if (intent === "balances") answer.limitations.push(accountCode ? "Saldo neraca kumulatif sampai akhir bulan; akun laba rugi dihitung sejak awal tahun buku klien." : "Saldo kumulatif sampai akhir bulan; rekening utang/cerukan tidak termasuk kas aset. Untuk akun lain, sebutkan kode akun.");
      if (/kenapa|mengapa|why|penyebab|banding|compare|perubahan|naik|turun/.test(question.toLowerCase())) answer.limitations.push("Jawaban menampilkan periode terpilih saja; perbandingan antarperiode dan penyebab perubahan belum didukung di Tanya Buku.");
    }
  }
  if (!answer.rows.length) answer.limitations.push("Tidak ada data yang cocok. Ini tidak berarti saldo nol atau pekerjaan telah lengkap.");
  answer.limitations = [...new Set(answer.limitations)];
  answer.citations = [...new Map(answer.citations.map(c => [c.href, c])).values()];
  return answer;
}
