import type { Db, Tx } from "@/lib/db";
import type { SubledgerKind } from "@/lib/generated/prisma/enums";
import { recordEvent } from "@/lib/audit";
import { closeLock } from "@/lib/adjust/schedules";
import { DECISION_MIN, findingLabel, openFinding } from "@/lib/findings";
import { formatDate } from "@/lib/format";
import { formatMoney, parseMoney } from "@/lib/money";
import { invoicesAt } from "@/lib/receivables/aging";
import { readAging, type AgingBucket } from "@/lib/reconcile/aging-read";

/**
 * Rekonsiliasi subledger (use-case UC-A1): a client's own aging (receivables or payables, from its operational system) at a date,
 * compared with the GL balance of the accounts it represents. Within the threshold the difference is rounding; beyond it, it opens one
 * Temuan (ADR 0012) that the accountant closes with an explanation. Buku shows candidate causes (cut-off lines near the date, advances,
 * non-trade accounts the aging leaves out, names on one side only) with their sources, never asserts one, and never posts.
 */
export class SubledgerError extends Error {}

export const KIND_LABEL: Record<SubledgerKind, string> = { RECEIVABLE: "piutang", PAYABLE: "utang" };
const DAY = 86_400_000;
const CUTOFF_DAYS = 7;
const ADVANCE = /uang muka|di ?terima di ?muka|dibayar di ?muka|advance|deposit|titipan/i;
const LEGAL = /\b(pt|cv|tbk|ud|persero|perseroan|terbatas)\b\.?/gi;

/** "PT. Sinar Jaya, Tbk" and "sinar jaya" are the same counterparty. */
export const normalName = (s: string) => s.toLowerCase().replace(LEGAL, " ").replace(/[^a-z0-9]+/g, " ").trim();

const sign = (kind: SubledgerKind) => (kind === "RECEIVABLE" ? 1n : -1n);
const abs = (v: bigint) => (v < 0n ? -v : v);
/** Percent of the GL, one decimal, half away from zero; null when the GL is zero. */
const percent = (diff: bigint, gl: bigint) => (gl === 0n ? null : Number((abs(diff) * 1000n + abs(gl) / 2n) / abs(gl)) / 10 * (diff < 0n ? -1 : 1));

async function defaultAccounts(db: Db | Tx, clientId: string, kind: SubledgerKind) {
  const accounts = await db.account.findMany({
    where: { clientId, ...(kind === "RECEIVABLE" ? { fsLine: "PIUTANG_USAHA", normalBalance: "DEBIT" } : { fsLine: "UTANG_USAHA", normalBalance: "CREDIT" }) },
    orderBy: { code: "asc" },
  });
  return accounts.map((a) => a.code);
}

/** Each account's balance at a date for one entity, as owed (receivable: debit +; payable: credit +). */
async function balances(db: Db | Tx, entityId: string, accountIds: string[], asOf: Date, kind: SubledgerKind) {
  const sums = await db.journalLine.groupBy({ by: ["accountId"], where: { entityId, accountId: { in: accountIds }, date: { lte: asOf } }, _sum: { debit: true, credit: true } });
  return new Map(sums.map((s) => [s.accountId, sign(kind) * ((s._sum.debit ?? 0n) - (s._sum.credit ?? 0n))]));
}

export type SubledgerStatus = "MATCH" | "ROUNDING" | "DIFFERENCE";

export type SubledgerComparison = {
  importId: string;
  entityId: string;
  entity: string;
  kind: SubledgerKind;
  asOf: Date;
  fileName: string;
  threshold: bigint;
  aging: bigint;
  ledger: bigint;
  difference: bigint;
  percent: number | null;
  status: SubledgerStatus;
  accounts: { code: string; name: string; balance: bigint }[];
  rows: { position: number; counterparty: string; total: bigint; buckets: Partial<Record<AgingBucket, string>>; sourceRef: string; rounded: boolean }[];
  /** Per counterparty against Buku's own open items (only when Buku holds invoices for the entity on this side). */
  counterparties: { name: string; aging: bigint; buku: bigint; difference: bigint; sourceRef: string | null }[] | null;
  candidates: {
    cutoff: { date: Date; memo: string; code: string; amount: bigint; entryId: string; source: string | null }[];
    credits: { counterparty: string; total: bigint; sourceRef: string }[];
    advances: { code: string; name: string; balance: bigint }[];
    nonTrade: { code: string; name: string; balance: bigint }[];
  };
  finding: { id: string; label: string; status: "OPEN" | "RESOLVED"; resolution: string | null } | null;
};

/** The comparison of one import, read fresh from the GL (nothing about the GL is stored). */
export async function compareSubledger(db: Db | Tx, clientId: string, importId: string): Promise<SubledgerComparison> {
  const imp = await db.subledgerImport.findFirst({
    where: { id: importId, clientId },
    include: { entity: true, rows: { orderBy: { position: "asc" } }, finding: true },
  });
  if (!imp) throw new SubledgerError("Impor aging tidak ditemukan.");
  const kind = imp.kind;
  const accounts = await db.account.findMany({ where: { clientId }, orderBy: { code: "asc" } });
  const compared = accounts.filter((a) => imp.accountCodes.includes(a.code));
  const bal = await balances(db, imp.entityId, accounts.map((a) => a.id), imp.asOf, kind);
  const ledger = compared.reduce((s, a) => s + (bal.get(a.id) ?? 0n), 0n);
  const aging = imp.rows.reduce((s, r) => s + r.total, 0n);
  const difference = aging - ledger;
  const status: SubledgerStatus = difference === 0n ? "MATCH" : abs(difference) <= imp.threshold ? "ROUNDING" : "DIFFERENCE";

  // Cut-off: GL lines on the compared accounts within a week either side of the date, largest first, with their source.
  const near = await db.journalLine.findMany({
    where: { entityId: imp.entityId, accountId: { in: compared.map((a) => a.id) }, date: { gte: new Date(+imp.asOf - CUTOFF_DAYS * DAY), lte: new Date(+imp.asOf + CUTOFF_DAYS * DAY) } },
    include: { account: { select: { code: true } }, entry: { select: { id: true, memo: true, bankTransactionId: true, ledgerImportId: true } } },
  });
  const cutoff = near
    .map((l) => ({
      date: l.date,
      memo: l.memo ?? l.entry.memo,
      code: l.account.code,
      amount: sign(kind) * (l.debit - l.credit),
      entryId: l.entry.id,
      source: l.entry.bankTransactionId ? "rekening koran" : l.sourceRef ?? (l.entry.ledgerImportId ? "file buku besar" : null),
    }))
    .sort((a, b) => (abs(b.amount) > abs(a.amount) ? 1 : -1))
    .slice(0, 20);

  // Advances: credit rows in the aging, and balances on advance accounts of the other side.
  const credits = imp.rows.filter((r) => r.total < 0n).map((r) => ({ counterparty: r.counterparty, total: r.total, sourceRef: r.sourceRef }));
  const owed = (a: (typeof accounts)[number]) => bal.get(a.id) ?? 0n;
  const advances = accounts
    .filter((a) => !imp.accountCodes.includes(a.code) && ADVANCE.test(a.name) && (kind === "RECEIVABLE" ? a.type === "LIABILITAS" : a.type === "ASET"))
    .map((a) => ({ code: a.code, name: a.name, balance: kind === "RECEIVABLE" ? -owed(a) : owed(a) }))
    .filter((a) => a.balance !== 0n);
  // Non-trade: what an aging summary leaves out (UC-A1 trap: "the aging doesn't cover all payables").
  const nonTrade = accounts
    .filter((a) => !imp.accountCodes.includes(a.code) && !ADVANCE.test(a.name) && !a.isClearing && !a.isBank && !a.isSuspense)
    .filter((a) => (kind === "PAYABLE" ? a.type === "LIABILITAS" : a.fsLine === "PIUTANG_LAIN" || (a.fsLine === "PIUTANG_USAHA" && a.normalBalance === "DEBIT")))
    .map((a) => ({ code: a.code, name: a.name, balance: owed(a) }))
    .filter((a) => a.balance !== 0n);

  // Per counterparty, when Buku keeps its own invoices on this side for the entity.
  const items = await invoicesAt(db as Db, clientId, kind === "RECEIVABLE" ? "SALES" : "PURCHASE", imp.asOf, [imp.entityId]);
  let counterparties: SubledgerComparison["counterparties"] = null;
  if (items.length) {
    const buku = new Map<string, { name: string; open: bigint }>();
    for (const i of items) {
      const k = normalName(i.contact.name);
      buku.set(k, { name: i.contact.name, open: (buku.get(k)?.open ?? 0n) + i.open });
    }
    const seen = new Set<string>();
    counterparties = imp.rows.map((r) => {
      const k = normalName(r.counterparty);
      seen.add(k);
      const b = buku.get(k)?.open ?? 0n;
      return { name: r.counterparty, aging: r.total, buku: b, difference: r.total - b, sourceRef: r.sourceRef };
    });
    for (const [k, b] of buku) if (!seen.has(k) && b.open !== 0n) counterparties.push({ name: b.name, aging: 0n, buku: b.open, difference: -b.open, sourceRef: null });
    counterparties = counterparties.filter((c) => c.difference !== 0n).sort((a, b) => (abs(b.difference) > abs(a.difference) ? 1 : -1));
  }

  return {
    importId: imp.id,
    entityId: imp.entityId,
    entity: imp.entity.shortName,
    kind,
    asOf: imp.asOf,
    fileName: imp.fileName,
    threshold: imp.threshold,
    aging,
    ledger,
    difference,
    percent: percent(difference, ledger),
    status,
    accounts: compared.map((a) => ({ code: a.code, name: a.name, balance: bal.get(a.id) ?? 0n })),
    rows: imp.rows.map((r) => ({ position: r.position, counterparty: r.counterparty, total: r.total, buckets: r.buckets as Partial<Record<AgingBucket, string>>, sourceRef: r.sourceRef, rounded: r.rounded })),
    counterparties,
    candidates: { cutoff, credits, advances, nonTrade },
    finding: imp.finding ? { id: imp.finding.id, label: findingLabel(imp.finding.number), status: imp.finding.status, resolution: imp.finding.resolution } : null,
  };
}

const question = (c: SubledgerComparison) =>
  `Aging ${KIND_LABEL[c.kind]} ${c.entity} per ${formatDate(c.asOf)} (${c.fileName}) ${formatMoney(c.aging, "IDR")} vs buku besar ${formatMoney(c.ledger, "IDR")} (${c.accounts.map((a) => a.code).join(", ")}): selisih ${formatMoney(c.difference, "IDR")}${c.percent === null ? "" : ` (${c.percent.toLocaleString("id-ID")}%)`}. Apa penyebabnya: cut-off sekitar tanggal itu, uang muka, akun non-trade, atau faktur yang belum tercatat?`;

/**
 * Imports an aging and reconciles it. The same entity, kind and date replaces the earlier import; its Temuan carries over: updated
 * while the difference stands, closed when the new aging matches, and a new one opened only when there was none open.
 */
export async function importAging(
  db: Db,
  input: { clientId: string; entityId: string; kind: SubledgerKind; asOf: string; fileName: string; data: Buffer; accountCodes?: string[]; threshold?: string; actorId?: string | null },
) {
  if (input.kind !== "RECEIVABLE" && input.kind !== "PAYABLE") throw new SubledgerError("Pilih jenis aging: piutang atau utang.");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.asOf);
  if (!m) throw new SubledgerError("Isi tanggal aging (per tanggal berapa).");
  const asOf = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const entity = await db.entity.findFirst({ where: { id: input.entityId, clientId: input.clientId } });
  if (!entity) throw new SubledgerError("Pilih entitas.");
  if (entity.functionalCurrency !== "IDR") throw new SubledgerError("Rekonsiliasi aging baru untuk pembukuan Rupiah.");
  let threshold = 1000n;
  if (input.threshold?.trim()) {
    try {
      threshold = parseMoney(input.threshold, "IDR");
    } catch {
      throw new SubledgerError("Batas pembulatan tidak terbaca. Tulis nominal, mis. 1.000.");
    }
    if (threshold < 0n) throw new SubledgerError("Batas pembulatan tidak boleh negatif.");
  }
  const read = await readAging(input.data);
  const codes = input.accountCodes?.length ? input.accountCodes : await defaultAccounts(db, input.clientId, input.kind);
  const known = await db.account.findMany({ where: { clientId: input.clientId, code: { in: codes } }, select: { code: true } });
  if (!known.length) throw new SubledgerError(`Belum ada akun ${input.kind === "RECEIVABLE" ? "piutang usaha" : "utang usaha"} untuk dibandingkan. Pilih akunnya.`);
  if (known.length !== codes.length) throw new SubledgerError(`Akun ${codes.filter((c) => !known.some((k) => k.code === c)).join(", ")} tidak ada di bagan akun klien.`);

  return db.$transaction(async (tx) => {
    // Temuan numbers and the close read these together: one writer per client.
    await closeLock(tx, input.clientId);
    const previous = await tx.subledgerImport.findUnique({ where: { entityId_kind_asOf: { entityId: entity.id, kind: input.kind, asOf } }, include: { finding: true } });
    if (previous) await tx.subledgerImport.delete({ where: { id: previous.id } });
    const imp = await tx.subledgerImport.create({
      data: {
        firmId: entity.firmId,
        clientId: input.clientId,
        entityId: entity.id,
        kind: input.kind,
        asOf,
        fileName: input.fileName,
        accountCodes: codes,
        threshold,
        createdById: input.actorId ?? null,
        rows: {
          create: read.rows.map((r, i) => ({ position: i, counterparty: r.counterparty, total: r.total, buckets: Object.fromEntries(Object.entries(r.buckets).map(([k, v]) => [k, v!.toString()])), sourceRef: r.sourceRef, rounded: r.rounded })),
        },
      },
    });
    const c = await compareSubledger(tx, input.clientId, imp.id);
    const open = previous?.finding?.status === "OPEN" ? previous.finding : null;
    let findingId: string | null = open?.id ?? null;
    if (c.status === "DIFFERENCE") {
      if (open) await tx.finding.update({ where: { id: open.id }, data: { amount: c.difference, question: question(c) } });
      else findingId = (await openFinding(tx, { clientId: input.clientId, entityId: entity.id, kind: "SUBLEDGER_DIFFERENCE", date: asOf, amount: c.difference, question: question(c), actorId: input.actorId })).id;
    } else if (open) {
      const resolution = `Aging baru per ${formatDate(asOf)} (${input.fileName}) cocok dengan buku besar${c.status === "ROUNDING" ? ` dalam batas pembulatan (${formatMoney(c.difference, "IDR")})` : ""}.`;
      await tx.finding.update({ where: { id: open.id }, data: { status: "RESOLVED", resolution, resolvedById: input.actorId ?? null, resolvedAt: new Date() } });
    }
    if (findingId) await tx.subledgerImport.update({ where: { id: imp.id }, data: { findingId } });
    await recordEvent(tx, {
      clientId: input.clientId,
      entityId: entity.id,
      kind: "SUBLEDGER",
      subject: `subledger:${entity.id}:${input.kind}:${input.asOf}`,
      summary: `Aging ${KIND_LABEL[input.kind]} ${entity.shortName} per ${formatDate(asOf)} diimpor (${input.fileName}, ${read.rows.length} baris): ${formatMoney(c.aging, "IDR")} vs buku besar ${formatMoney(c.ledger, "IDR")}${previous ? " · menggantikan impor sebelumnya" : ""}`,
      after: { rows: read.rows.length, aging: c.aging.toString(), ledger: c.ledger.toString(), difference: c.difference.toString(), status: c.status },
      actorId: input.actorId,
    });
    return { importId: imp.id, status: c.status, difference: c.difference, notes: read.notes, rows: read.rows.length };
  });
}

/** Closes a subledger Temuan with the accountant's explanation; optionally names the correcting journal already posted. Posts nothing. */
export async function resolveSubledgerFinding(db: Db, input: { clientId: string; findingId: string; explanation: string; entryId?: string | null; actorId?: string | null }) {
  const explanation = input.explanation.trim();
  if (explanation.length < DECISION_MIN) throw new SubledgerError(`Tulis penjelasannya (min. ${DECISION_MIN} karakter): apa penyebab selisih dan siapa yang mengonfirmasi.`);
  return db.$transaction(async (tx) => {
    await closeLock(tx, input.clientId);
    const f = await tx.finding.findFirst({ where: { id: input.findingId, clientId: input.clientId } });
    if (!f || f.kind !== "SUBLEDGER_DIFFERENCE") throw new SubledgerError("Temuan rekonsiliasi tidak ditemukan.");
    if (f.status !== "OPEN") throw new SubledgerError(`${findingLabel(f.number)} sudah ditutup.`);
    let entryId: string | null = null;
    if (input.entryId) {
      const e = await tx.journalEntry.findFirst({ where: { id: input.entryId, entityId: f.entityId }, select: { id: true } });
      if (!e) throw new SubledgerError("Jurnal koreksi tidak ditemukan di entitas ini.");
      entryId = e.id;
    }
    await recordEvent(tx, {
      clientId: input.clientId,
      entityId: f.entityId,
      kind: "FINDING_RESOLVED",
      subject: `finding:${f.id}`,
      summary: `${findingLabel(f.number)} ditutup: ${explanation}`,
      before: { status: "OPEN", difference: f.amount.toString() },
      after: { status: "RESOLVED", explanation, entryId },
      actorId: input.actorId,
    });
    return tx.finding.update({ where: { id: f.id }, data: { status: "RESOLVED", resolution: explanation, resolvedEntryId: entryId, resolvedById: input.actorId ?? null, resolvedAt: new Date() } });
  });
}

/** Removes an import (a wrong file or date): its rows go, and its open Temuan is closed saying so. */
export async function deleteSubledgerImport(db: Db, input: { clientId: string; importId: string; actorId?: string | null }) {
  return db.$transaction(async (tx) => {
    await closeLock(tx, input.clientId);
    const imp = await tx.subledgerImport.findFirst({ where: { id: input.importId, clientId: input.clientId }, include: { entity: true, finding: true } });
    if (!imp) throw new SubledgerError("Impor aging tidak ditemukan.");
    if (imp.finding?.status === "OPEN") {
      await tx.finding.update({ where: { id: imp.finding.id }, data: { status: "RESOLVED", resolution: `Impor aging ${imp.fileName} dihapus.`, resolvedById: input.actorId ?? null, resolvedAt: new Date() } });
    }
    await tx.subledgerImport.delete({ where: { id: imp.id } });
    await recordEvent(tx, {
      clientId: input.clientId,
      entityId: imp.entityId,
      kind: "SUBLEDGER",
      subject: `subledger:${imp.entityId}:${imp.kind}:${imp.asOf.toISOString().slice(0, 10)}`,
      summary: `Aging ${KIND_LABEL[imp.kind]} ${imp.entity.shortName} per ${formatDate(imp.asOf)} (${imp.fileName}) dihapus`,
      actorId: input.actorId,
    });
  });
}

/** The client's imports, newest date first, for the entities in scope. */
export async function listSubledgerImports(db: Db, clientId: string, entityIds: string[]) {
  return db.subledgerImport.findMany({ where: { clientId, entityId: { in: entityIds } }, orderBy: [{ asOf: "desc" }, { kind: "asc" }], select: { id: true } });
}
