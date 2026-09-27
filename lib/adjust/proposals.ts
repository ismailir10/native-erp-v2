import type { Db } from "@/lib/db";
import type { ProposalSource } from "@/lib/generated/prisma/enums";
import { LedgerError, postJournal } from "@/lib/ledger/post";
import { periodBounds } from "@/lib/format";

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
};

/** Stores a proposal once per key (a cached AI answer or a suspense line never duplicates). */
export async function saveProposal(db: Db, p: NewProposal) {
  const existing = await db.proposedEntry.findUnique({ where: { key: p.key } });
  if (existing) return existing;
  try {
    return await db.proposedEntry.create({ data: { ...p, controlKey: p.controlKey ?? null, refs: p.refs ?? [], lines: p.lines } });
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
  const date = periodBounds(p.year, p.month).end;
  return db.$transaction(async (tx) => {
    const entry = await postJournal(tx, { entityId: p.entityId, date, kind: "ADJUSTMENT", memo: p.memo, lines: posting, actorId: input.actorId });
    // Only a still-open proposal can be decided: a concurrent click rolls this transaction back.
    const done = await tx.proposedEntry.updateMany({ where: { id: p.id, status: "PROPOSED" }, data: { status: "POSTED", entryId: entry.id, decidedById: input.actorId ?? null, decidedAt: new Date() } });
    if (done.count !== 1) throw new LedgerError("Usulan ini sudah diputuskan.");
    return entry;
  });
}

export async function dismissProposal(db: Db, input: { clientId: string; proposalId: string; actorId?: string | null }) {
  const done = await db.proposedEntry.updateMany({ where: { id: input.proposalId, clientId: input.clientId, status: "PROPOSED" }, data: { status: "DISMISSED", decidedById: input.actorId ?? null, decidedAt: new Date() } });
  if (done.count !== 1) throw new LedgerError("Usulan tidak ditemukan atau sudah diputuskan.");
}
