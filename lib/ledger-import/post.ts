import { createHash } from "node:crypto";
import type { Db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { postJournal, type PostLine } from "@/lib/ledger/post";
import { ACCOUNT_CODES } from "@/lib/coa/template";
import { formatDate } from "@/lib/format";
import { loadRates, lookupRate, upsertFileRate } from "@/lib/fx/rates";
import { formatRate, isCurrency, parseRate } from "@/lib/fx/currency";
import { ParseError } from "@/lib/import/types";
import { detectTables, readSheets, readTable } from "@/lib/ledger-import/read";
import { accountKey, planLedger, planNeraca, type Check, type CurrencyMode, type EntityInfo, type Plan, type PlanEntry } from "@/lib/ledger-import/check";
import { inferType } from "@/lib/ledger-import/mapping";
import type { TableCandidate } from "@/lib/ledger-import/types";

/**
 * Ledger / Neraca import (accounting-rules §15a): stage (read → check → source accounts → DRAFT plan),
 * then post the saved plan all-or-nothing once every BLOCK is fixed or accepted and every source account is mapped.
 */

export class LedgerImportError extends Error {}

/** A file's entity label belongs to the client entity with that short or full name (case-insensitive). No fuzzy match. */
export function entityForLabel<E extends { shortName: string; name: string }>(entities: E[], label: string): E | undefined {
  const l = label.trim().toLowerCase();
  return l ? entities.find((e) => [e.shortName, e.name].some((n) => n.toLowerCase() === l)) : undefined;
}

export type StageInput = {
  /** Evidence handoff: the file must stay inside the confirmed dates, currency and entities. */
  allowedPeriod?: { start: string; end: string; currency?: string; entityIds?: string[] };
  evidenceVersionId?: string;
  evidenceUnitKey?: string;
  firmId: string;
  clientId: string;
  fileName: string;
  data: Buffer;
  /** Sheet to read when the file has several tables. */
  sheet?: string;
  /** File entity label → client entity id. Labels matching an entity's short/full name are paired automatically. */
  entityMap?: Record<string, string>;
  /** Files without an entity column (and every Neraca) go to this entity. */
  entityId?: string;
  /** Neraca date when the file doesn't state one. */
  date?: Date;
  currencyMode?: CurrencyMode;
};

export type StageResult =
  | { status: "CHOOSE_SHEET"; candidates: TableCandidate[] }
  | { status: "STAGED"; importId: string; mode: "LEDGER" | "NERACA"; checks: Check[]; entries: number; sourceAccounts: number; unmapped: number };

type FileRate = { currency: string; quote: string; date: string; rate: string; ref: string };
type SavedPlan = { rates?: FileRate[]; entries: (Omit<PlanEntry, "date" | "imbalance" | "rounding" | "lines"> & { date: string; imbalance: string; rounding: string; lines: (Omit<PlanEntry["lines"][number], "amount" | "fx"> & { amount: string; fx: { currency: string; amount: string; rate: string } | null })[] })[]; entities: Record<string, string> };

const toSaved = (entries: PlanEntry[], entities: Map<string, EntityInfo>): SavedPlan => ({
  entities: Object.fromEntries([...entities].map(([k, v]) => [k, v.entityId])),
  entries: entries.map((e) => ({
    ...e,
    date: e.date.toISOString().slice(0, 10),
    imbalance: e.imbalance.toString(),
    rounding: e.rounding.toString(),
    lines: e.lines.map((l) => ({ ...l, amount: l.amount.toString(), fx: l.fx ? { ...l.fx, amount: l.fx.amount.toString() } : null })),
  })),
});

/** A group posts when it yields at least two lines: non-zero file lines plus any rounding or source-difference line. */
function willPost(e: PlanEntry) {
  return e.lines.filter((l) => l.amount !== 0n).length + (e.rounding !== 0n ? 1 : 0) + (e.imbalance !== 0n ? 1 : 0) >= 2;
}

export async function stageImport(db: Db, input: StageInput): Promise<StageResult> {
  const sheets = await readSheets(input.fileName, input.data);
  const candidates = detectTables(sheets);
  if (!candidates.length) throw new ParseError("Tabel buku besar atau neraca tidak ditemukan. Pastikan ada baris judul kolom (tanggal, kode akun, debit, kredit — atau kode akun dan saldo).");
  const table = input.sheet ? candidates.find((c) => c.sheet === input.sheet) : candidates.length === 1 ? candidates[0] : null;
  if (!table) return { status: "CHOOSE_SHEET", candidates };

  const fileHash = createHash("sha256").update(input.data).update(`|${table.sheet}`).digest("hex");
  const posted = await db.ledgerImport.findFirst({ where: { clientId: input.clientId, fileHash, status: "POSTED" } });
  if (posted) throw new LedgerImportError(`Sheet "${table.sheet}" dari file ini sudah diimpor (${formatDate(posted.postedAt ?? posted.createdAt)}).`);

  const entities = await db.entity.findMany({ where: { clientId: input.clientId } });
  const read = readTable(sheets, table);
  const currencyMode = input.currencyMode ?? "FUNCTIONAL";
  const info = (id: string) => {
    const e = entities.find((x) => x.id === id);
    if (!e) throw new LedgerImportError("Entitas tidak ditemukan untuk klien ini");
    return { entityId: e.id, name: e.shortName, currency: e.functionalCurrency } satisfies EntityInfo;
  };
  const existing = await db.sourceAccount.findMany({ where: { clientId: input.clientId } });

  let plan: Plan;
  const entityInfos = new Map<string, EntityInfo>();
  let periodStart: Date;
  let periodEnd: Date;
  if (read.mode === "LEDGER") {
    const labels = [...new Set(read.rows.map((r) => r.entity ?? ""))];
    for (const label of labels) {
      const id =
        input.entityMap?.[label] ??
        (label === "" ? input.entityId : undefined) ??
        entityForLabel(entities, label)?.id ??
        (labels.length === 1 ? input.entityId : undefined);
      if (id) entityInfos.set(label, info(id));
    }
    const existingNames = new Map<string, string>();
    for (const [label, ei] of entityInfos) for (const s of existing.filter((x) => x.entityId === ei.entityId)) existingNames.set(accountKey(label, s.code), s.name);
    const rates = currencyMode === "CONVERT" ? await loadRates(db, input.firmId) : [];
    plan = planLedger(read.rows, { entities: entityInfos, currencyMode, rateFor: (c, f, d) => lookupRate(rates, c, f, d), existingNames });
    const dates = read.rows.filter((r) => r.date).map((r) => +r.date!);
    periodStart = new Date(dates.length ? Math.min(...dates) : Date.now());
    periodEnd = new Date(dates.length ? Math.max(...dates) : Date.now());
  } else {
    if (!input.entityId) throw new LedgerImportError("Pilih entitas untuk neraca ini.");
    await assertNoOpening(db, [input.entityId]);
    const date = read.date ?? input.date;
    if (!date) throw new LedgerImportError("Tanggal neraca tidak tertulis di file. Isi tanggalnya.");
    entityInfos.set("", info(input.entityId));
    const existingNames = new Map(existing.filter((x) => x.entityId === input.entityId).map((s) => [accountKey("", s.code), s.name]));
    plan = planNeraca(read.rows, read.totals, { entityKey: "", entity: info(input.entityId), date, sheet: table.sheet, existingNames });
    periodStart = periodEnd = date;
  }

  if (input.allowedPeriod && (periodStart.toISOString().slice(0, 10) < input.allowedPeriod.start || periodEnd.toISOString().slice(0, 10) > input.allowedPeriod.end)) throw new LedgerImportError("Rentang sumber harus mencakup seluruh periode file.");

  if (input.allowedPeriod?.entityIds && [...entityInfos.values()].some(e => !input.allowedPeriod!.entityIds!.includes(e.entityId))) throw new LedgerImportError("File mencakup entitas lain di luar pilihan sumber. Pisahkan sheet atau gunakan impor manual.");
  if (input.allowedPeriod?.currency && [...entityInfos.values()].some(e => e.currency !== input.allowedPeriod!.currency)) throw new LedgerImportError("Mata uang fungsional entitas berbeda dengan pilihan sumber.");

  // Rates written in the file (rate column or "Rate: 1.31" notes) are kept and saved to the Kurs table on post.
  const fileRates = new Map<string, FileRate>();
  if (read.mode === "LEDGER") {
    for (const r of read.rows) {
      const ei = entityInfos.get(r.entity ?? "");
      if (!ei || !r.rate || !r.date || !r.currency || !isCurrency(r.currency) || r.currency === ei.currency) continue;
      try {
        const rate = formatRate(parseRate(r.rate));
        const date = r.date.toISOString().slice(0, 10);
        fileRates.set(`${r.currency}|${ei.currency}|${date}`, { currency: r.currency, quote: ei.currency, date, rate, ref: r.ref });
      } catch {
        // an unreadable rate note is just not a rate
      }
    }
  }
  // All-zero groups are reported in the checks ("… jurnal bernilai nol dilewati") but not staged, so the draft's
  // "Catat N jurnal" is the number that will post.
  const entries = plan.entries.filter(willPost);
  const neracaHints = read.mode === "NERACA" ? new Map(read.rows.map((r) => [r.code, r.typeHint])) : new Map();
  const imp = await db.$transaction(
    async (tx) => {
      // Source accounts: create new codes, keep the latest name, remember earlier names (rule 9a, assumption 4).
      for (const a of plan.accounts.values()) {
        const ei = entityInfos.get(a.entityKey);
        if (!ei) continue;
        const found = existing.find((s) => s.entityId === ei.entityId && s.code === a.code);
        const typeHint = neracaHints.get(a.code) ?? inferType(a.code, a.name);
        if (!found) {
          await tx.sourceAccount.create({ data: { firmId: input.firmId, clientId: input.clientId, entityId: ei.entityId, code: a.code, name: a.name, previousNames: a.previousNames, typeHint } });
        } else if (found.name !== a.name || a.previousNames.some((p) => !found.previousNames.includes(p))) {
          await tx.sourceAccount.update({ where: { id: found.id }, data: { name: a.name, previousNames: [...new Set([...found.previousNames, ...a.previousNames])].filter((p) => p !== a.name) } });
        }
      }
      return tx.ledgerImport.create({
        data: {
          firmId: input.firmId,
          clientId: input.clientId,
          fileName: input.fileName,
          evidenceVersionId: input.evidenceVersionId,
          evidenceUnitKey: input.evidenceUnitKey,
          fileHash,
          sheetName: table.sheet,
          mode: read.mode,
          currencyMode,
          periodStart,
          periodEnd,
          rowCount: read.rows.length,
          groupCount: entries.length,
          roundingTotal: entries.reduce((s, e) => s + (e.rounding < 0n ? -e.rounding : e.rounding), 0n),
          data: { ...toSaved(entries, entityInfos), rates: [...fileRates.values()] } as unknown as Prisma.InputJsonValue,
          checks: {
            create: plan.checks.map((c) => ({
              severity: c.severity,
              code: c.code,
              message: c.message,
              refs: c.refs,
              entityId: c.entityKey !== undefined ? (entityInfos.get(c.entityKey)?.entityId ?? null) : null,
              date: c.date ?? null,
              amount: c.amount ?? null,
            })),
          },
        },
      });
    },
    { timeout: 120_000 },
  );
  const entityIds = [...entityInfos.values()].map((e) => e.entityId);
  const codes = [...plan.accounts.values()].map((a) => a.code);
  const unmapped = await db.sourceAccount.count({ where: { entityId: { in: entityIds }, code: { in: codes }, accountId: null } });
  return { status: "STAGED", importId: imp.id, mode: read.mode, checks: plan.checks, entries: entries.length, sourceAccounts: plan.accounts.size, unmapped };
}

/** Rule 5: one opening entry per entity. */
async function assertNoOpening(db: Db, entityIds: string[]) {
  const opening = await db.journalEntry.findFirst({ where: { entityId: { in: entityIds }, kind: "OPENING" } });
  if (opening) throw new LedgerImportError(`Saldo awal entitas ini sudah ada (${formatDate(opening.date)}). Koreksi lewat Jurnal Penyesuaian.`);
}

/** Accept an acceptable BLOCK (unbalanced group): its difference will post to 1999, visible until fixed. */
export async function acceptCheck(db: Db, clientId: string, checkId: string) {
  const check = await db.importCheck.findFirst({ where: { id: checkId, ledgerImport: { clientId, status: "DRAFT" } } });
  if (!check) throw new LedgerImportError("Pemeriksaan tidak ditemukan");
  if (check.severity !== "BLOCK" || check.code !== "UNBALANCED") throw new LedgerImportError("Hanya jurnal tidak seimbang yang bisa diterima; perbaiki file untuk masalah lain.");
  return db.importCheck.update({ where: { id: checkId }, data: { accepted: true } });
}

/** Source accounts this draft needs, with their mapping state (for the Pemetaan akun page). */
export async function importSourceAccounts(db: Db, importId: string) {
  const imp = await db.ledgerImport.findUniqueOrThrow({ where: { id: importId } });
  const saved = imp.data as unknown as SavedPlan;
  const pairs = new Map<string, Set<string>>();
  for (const e of saved.entries) {
    const entityId = saved.entities[e.entityKey];
    for (const l of e.lines) (pairs.get(entityId) ?? pairs.set(entityId, new Set()).get(entityId)!).add(l.code);
  }
  const or = [...pairs].map(([entityId, codes]) => ({ entityId, code: { in: [...codes] } }));
  return or.length ? db.sourceAccount.findMany({ where: { OR: or }, include: { account: true, entity: true }, orderBy: [{ entityId: "asc" }, { code: "asc" }] }) : [];
}

export async function postImport(db: Db, clientId: string, importId: string) {
  const imp = await db.ledgerImport.findFirst({ where: { id: importId, clientId }, include: { checks: true } });
  if (!imp) throw new LedgerImportError("Impor tidak ditemukan");
  if (imp.status === "POSTED") throw new LedgerImportError("Impor ini sudah dicatat.");
  const blocking = imp.checks.filter((c) => c.severity === "BLOCK" && !c.accepted);
  if (blocking.length) throw new LedgerImportError(`${blocking.length} masalah BLOCK belum diselesaikan. Perbaiki file atau terima selisihnya.`);
  const again = await db.ledgerImport.findFirst({ where: { clientId, fileHash: imp.fileHash, status: "POSTED" } });
  if (again) throw new LedgerImportError("Sheet ini sudah diimpor.");

  const saved = imp.data as unknown as SavedPlan;
  if (imp.mode === "NERACA") await assertNoOpening(db, Object.values(saved.entities));
  const sources = await importSourceAccounts(db, importId);
  const unmapped = sources.filter((s) => !s.accountId);
  if (unmapped.length) throw new LedgerImportError(`${unmapped.length} akun sumber belum dipetakan. Selesaikan Pemetaan akun dulu.`);
  const sourceOf = new Map(sources.map((s) => [`${s.entityId}|${s.code}`, s]));
  const accounts = await db.account.findMany({ where: { clientId, code: { in: [ACCOUNT_CODES.ROUNDING, ACCOUNT_CODES.SUSPENSE] } } });
  const rounding = accounts.find((a) => a.code === ACCOUNT_CODES.ROUNDING)!;
  const suspense = accounts.find((a) => a.code === ACCOUNT_CODES.SUSPENSE)!;

  return db.$transaction(
    async (tx) => {
      let posted = 0;
      for (const e of saved.entries) {
        const entityId = saved.entities[e.entityKey];
        const lines: PostLine[] = [];
        for (const l of e.lines) {
          const amount = BigInt(l.amount);
          if (amount === 0n) continue;
          const src = sourceOf.get(`${entityId}|${l.code}`)!;
          const abs = amount < 0n ? -amount : amount;
          lines.push({
            accountId: src.accountId!,
            sourceAccountId: src.id,
            sourceRef: l.ref,
            debit: amount > 0n ? abs : 0n,
            credit: amount < 0n ? abs : 0n,
            memo: l.memo?.slice(0, 300) ?? undefined,
            fx: l.fx ? { currency: l.fx.currency, amount: BigInt(l.fx.amount), rate: l.fx.rate } : null,
          });
        }
        const r = BigInt(e.rounding);
        if (r !== 0n) lines.push({ accountId: rounding.id, debit: r > 0n ? r : 0n, credit: r < 0n ? -r : 0n, memo: "Selisih pembulatan sen ke Rupiah" });
        const imbalance = BigInt(e.imbalance);
        if (imbalance !== 0n) lines.push({ accountId: suspense.id, debit: imbalance < 0n ? -imbalance : 0n, credit: imbalance > 0n ? imbalance : 0n, memo: "Selisih dari file sumber" });
        if (lines.length < 2) continue;
        await postJournal(tx, {
          entityId,
          date: new Date(`${e.date}T00:00:00.000Z`),
          kind: imp.mode === "NERACA" ? "OPENING" : "IMPORTED",
          memo: `${e.memo} · ${imp.fileName}`.slice(0, 300),
          ledgerImportId: imp.id,
          sourceRef: e.ref,
          lines,
        });
        posted++;
      }
      for (const r of saved.rates ?? []) {
        await upsertFileRate(tx, imp.firmId, { currency: r.currency, quote: r.quote, date: new Date(`${r.date}T00:00:00.000Z`), kind: "SPOT", rate: r.rate, note: `${imp.fileName} ${r.ref}` });
      }
      await tx.ledgerImport.update({ where: { id: imp.id }, data: { status: "POSTED", postedAt: new Date(), groupCount: posted } });
      return { entries: posted };
    },
    { timeout: 300_000, maxWait: 20_000 },
  );
}
