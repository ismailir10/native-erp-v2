import type { Db } from "@/lib/db";
import type { ProposalSource } from "@/lib/generated/prisma/enums";
import { LedgerError, postJournal } from "@/lib/ledger/post";
import { periodBounds } from "@/lib/format";
import { reviewTransactionTx } from "@/lib/review";

/**
 * Proposed entries (accounting-rules 20b): draft journals from the close copilot or a deterministic check. Nothing posts until
 * the accountant clicks; then postJournal() writes an ADJUSTMENT and the proposal records it (one entry per proposal).
 * The accountant may change a line's account, never its amount.
 */

export type ProposalLine = { accountCode: string; debit: string; credit: string };

const DIGITS = /^\d{1,18}$/;

/** Lines as stored (JSON): shape-checked on every read, amounts as minor-unit strings. */
export function readLines(value: unknown): ProposalLine[] {
  if (!Array.isArray(value)) throw new LedgerError("Usulan jurnal rusak.");
  return value.map((l) => {
    const x = l as Record<string, unknown>;
    if (typeof x.accountCode !== "string" || typeof x.debit !== "string" || typeof x.credit !== "string" || !DIGITS.test(x.debit) || !DIGITS.test(x.credit)) throw new LedgerError("Usulan jurnal rusak.");
    return { accountCode: x.accountCode, debit: x.debit, credit: x.credit };
  });
}

export type NewProposal = {
  firmId: string;
  clientId: string;
  entityId: string;
  year: number;
  month: number;
  source: ProposalSource;
  controlKey?: string | null;
  key: string;
  memo: string;
  lines: ProposalLine[];
  reason: string;
  refs?: string[];
  /** The draft re-classifies this bank line (posted through the review writer, rule 3). */
  bankTransactionId?: string | null;
};

/** Stores a proposal once per key (a cached AI answer or a suspense line never duplicates). */
export async function saveProposal(db: Db, p: NewProposal) {
  const existing = await db.proposedEntry.findUnique({ where: { key: p.key } });
  if (existing) return existing;
  try {
    return await db.proposedEntry.create({ data: { ...p, controlKey: p.controlKey ?? null, refs: p.refs ?? [], lines: p.lines, bankTransactionId: p.bankTransactionId ?? null } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return db.proposedEntry.findUniqueOrThrow({ where: { key: p.key } });
    throw e;
  }
}

export async function openProposals(db: Db, clientId: string, year: number, month: number) {
  return db.proposedEntry.findMany({
    where: { clientId, year, month, status: "PROPOSED" },
    include: { entity: { select: { id: true, shortName: true, functionalCurrency: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/** The accountant's click. `accounts` (optional) replaces each line's account code, in order; amounts never change. */
export async function postProposal(db: Db, input: { clientId: string; proposalId: string; accounts?: string[]; actorId?: string | null }) {
  const p = await db.proposedEntry.findFirst({ where: { id: input.proposalId, clientId: input.clientId } });
  if (!p) throw new LedgerError("Usulan tidak ditemukan.");
  if (p.status !== "PROPOSED") throw new LedgerError(p.status === "POSTED" ? "Usulan ini sudah dicatat." : "Usulan ini sudah diabaikan.");
  const lines = readLines(p.lines);
  if (input.accounts && input.accounts.length !== lines.length) throw new LedgerError("Jumlah akun tidak sesuai dengan baris usulan.");
  const codes = lines.map((l, i) => (input.accounts?.[i] ?? l.accountCode).trim());
  if (codes.some((c) => !c)) throw new LedgerError("Pilih akun untuk setiap baris.");
  const accounts = new Map((await db.account.findMany({ where: { clientId: input.clientId, code: { in: codes } } })).map((a) => [a.code, a]));
  const posting = lines.map((l, i) => {
    const a = accounts.get(codes[i]);
    if (!a) throw new LedgerError(`Akun ${codes[i]} tidak ada di bagan akun klien.`);
    if (a.isBank) throw new LedgerError("Usulan tidak boleh mengubah akun bank; sisi bank hanya berubah lewat mutasi.");
    return { accountId: a.id, debit: BigInt(l.debit), credit: BigInt(l.credit) };
  });
  if (p.bankTransactionId) return postBankReclass(db, p, lines, codes, input.actorId);
  const date = periodBounds(p.year, p.month).end;
  return db.$transaction(async (tx) => {
    const entry = await postJournal(tx, { entityId: p.entityId, date, kind: "ADJUSTMENT", memo: p.memo, lines: posting, actorId: input.actorId });
    // Only a still-open proposal can be decided: a concurrent click rolls this transaction back.
    const done = await tx.proposedEntry.updateMany({ where: { id: p.id, status: "PROPOSED" }, data: { status: "POSTED", entryId: entry.id, decidedById: input.actorId ?? null, decidedAt: new Date() } });
    if (done.count !== 1) throw new LedgerError("Usulan ini sudah diputuskan.");
    return entry;
  });
}

/**
 * A draft that moves one bank line to another account: the bank side never changes, so it goes through the reviewer's own
 * writer (a RECLASS of the difference, Memory learns it) instead of a free journal that would leave the line mis-coded.
 */
async function postBankReclass(db: Db, p: { id: string; entityId: string; bankTransactionId: string | null }, lines: ProposalLine[], codes: string[], actorId?: string | null) {
  const t = await db.bankTransaction.findFirst({ where: { id: p.bankTransactionId!, entityId: p.entityId } });
  if (!t || !t.accountCode) throw new LedgerError("Transaksi bank usulan ini tidak ditemukan.");
  const from = lines.findIndex((l) => l.accountCode === t.accountCode);
  if (from < 0 || lines.length !== 2) throw new LedgerError("Usulan ini tidak lagi cocok dengan transaksinya.");
  if (codes[from] !== t.accountCode) throw new LedgerError(`Baris ${t.accountCode} adalah akun transaksi saat ini; ganti akun tujuan saja.`);
  const target = codes[1 - from];
  if (target === t.accountCode) throw new LedgerError("Akun tujuan sama dengan akun saat ini.");
  return db.$transaction(async (tx) => {
    const before = new Set((await tx.journalEntry.findMany({ where: { bankTransactionId: t.id }, select: { id: true } })).map((e) => e.id));
    await reviewTransactionTx(tx, { bankTxId: t.id, accountCode: target, taxTag: t.taxTag, actorId });
    const entry = await tx.journalEntry.findFirst({ where: { bankTransactionId: t.id, kind: "RECLASS", id: { notIn: [...before] } } });
    if (!entry) throw new LedgerError("Tidak ada selisih untuk direklasifikasi.");
    const done = await tx.proposedEntry.updateMany({ where: { id: p.id, status: "PROPOSED" }, data: { status: "POSTED", entryId: entry.id, decidedById: actorId ?? null, decidedAt: new Date() } });
    if (done.count !== 1) throw new LedgerError("Usulan ini sudah diputuskan.");
    return entry;
  });
}

export async function dismissProposal(db: Db, input: { clientId: string; proposalId: string; actorId?: string | null }) {
  const done = await db.proposedEntry.updateMany({ where: { id: input.proposalId, clientId: input.clientId, status: "PROPOSED" }, data: { status: "DISMISSED", decidedById: input.actorId ?? null, decidedAt: new Date() } });
  if (done.count !== 1) throw new LedgerError("Usulan tidak ditemukan atau sudah diputuskan.");
}

/** Plain JSON for the proposals card (bigint as strings). */
export async function proposalViews(db: Db, clientId: string, year: number, month: number) {
  const rows = await openProposals(db, clientId, year, month);
  const txs = new Map((await db.bankTransaction.findMany({ where: { id: { in: rows.flatMap((p) => (p.bankTransactionId ? [p.bankTransactionId] : [])) } }, select: { id: true, accountCode: true } })).map((t) => [t.id, t.accountCode]));
  return rows.map((p) => {
    const lines = readLines(p.lines);
    const current = p.bankTransactionId ? txs.get(p.bankTransactionId) : null;
    const fixed = current ? lines.findIndex((l) => l.accountCode === current) : -1;
    return { id: p.id, memo: p.memo, reason: p.reason, source: p.source, entity: p.entity.shortName, currency: p.entity.functionalCurrency, fixed: fixed >= 0 ? fixed : null, lines };
  });
}

