import type { Db, Tx } from "@/lib/db";
import { LedgerError } from "@/lib/ledger/post";
import { formatDate, periodBounds } from "@/lib/format";
import { SOURCE_DIFFERENCE_MEMO } from "@/lib/ledger-import/post";
import { postProposal, proposalViews, saveProposal, type ProposalLine } from "@/lib/adjust/proposals";

/**
 * 1999 corrections (accounting-rules 15a / 20b): an accepted unbalanced ledger group left its difference on 1999. Each such line
 * gets a deterministic draft that reverses it on 1999 against a counter account — prefilled only when the same entry has exactly
 * one other line of that very amount. Computed at read time; stored as a ProposedEntry (key SUSPENSE:<lineId>) only when the
 * accountant posts or dismisses it.
 */

export const SUSPENSE_PREFIX = "suspense:";

export type SuspenseCorrection = {
  lineId: string;
  entity: { id: string; shortName: string; functionalCurrency: string };
  year: number;
  month: number;
  memo: string;
  reason: string;
  lines: ProposalLine[];
  /** The imported group it corrects (rule 15): the correction keeps its file and sheet!row. */
  origin: { ledgerImportId?: string; sourceRef?: string };
};

async function candidates(db: Db, clientId: string, where: { year: number; month: number } | { lineId: string }): Promise<SuspenseCorrection[]> {
  const range = "lineId" in where ? {} : (() => { const { start, end } = periodBounds(where.year, where.month); return { date: { gte: start, lte: end } }; })();
  const lines = await db.journalLine.findMany({
    where: { ...("lineId" in where ? { id: where.lineId } : range), memo: SOURCE_DIFFERENCE_MEMO, account: { clientId, isSuspense: true }, entry: { ledgerImportId: { not: null } } },
    include: { account: true, entry: { include: { entity: true, lines: { include: { account: true } } } } },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  // Only a posted correction hides a line; an open draft (a post that failed, e.g. locked period) is reused on the next click.
  // A 1999 difference can't be waved away (the close FAILs until 1999 is cleared), so there is no dismissed state to hide.
  const decided = new Set((await db.proposedEntry.findMany({ where: { key: { in: lines.map((l) => `SUSPENSE:${l.id}`) }, status: "POSTED" }, select: { key: true } })).map((p) => p.key));
  // A difference cleared some other way (e.g. a manual adjustment before these proposals existed) is not offered again.
  const open = new Map<string, boolean>();
  for (const l of lines) open.set(l.id, await outstanding(db, l));
  return lines.flatMap((l) => {
    if (decided.has(`SUSPENSE:${l.id}`) || !open.get(l.id)) return [];
    const amount = l.debit > 0n ? l.debit : l.credit;
    const same = l.entry.lines.filter((x) => x.id !== l.id && !x.account.isSuspense && (x.debit === amount || x.credit === amount));
    const counter = same.length === 1 ? same[0].account.code : "";
    const ref = l.entry.sourceRef ?? formatDate(l.date);
    const e = l.entry.entity;
    return [{
      lineId: l.id,
      entity: { id: e.id, shortName: e.shortName, functionalCurrency: e.functionalCurrency },
      year: l.date.getUTCFullYear(),
      month: l.date.getUTCMonth() + 1,
      memo: `Koreksi selisih file sumber ${ref}`.slice(0, 120),
      origin: { ledgerImportId: l.entry.ledgerImportId ?? undefined, sourceRef: l.sourceRef ?? l.entry.sourceRef ?? undefined },
      reason: counter ? `Satu baris ${counter} di grup ${ref} bernilai sama dengan selisihnya: kemungkinan tercatat ganda atau pasangannya tidak ada di file` : `Pilih akun lawan untuk selisih grup ${ref}`,
      // Reverse the 1999 line; the counter side takes the other half.
      lines: [
        { accountCode: l.account.code, debit: l.credit > 0n ? amount.toString() : "0", credit: l.debit > 0n ? amount.toString() : "0" },
        { accountCode: counter, debit: l.debit > 0n ? amount.toString() : "0", credit: l.credit > 0n ? amount.toString() : "0" },
      ],
    }];
  });
}

/**
 * Whether 1999 still holds this line's difference: the entity's 1999 balance through the line's month-end (what the ledger
 * control reads) is on the line's side and at least its amount, so reversing it moves 1999 toward zero and never past it.
 */
async function outstanding(db: Db | Tx, l: { entityId: string; accountId: string; date: Date; debit: bigint; credit: bigint }) {
  const { end } = periodBounds(l.date.getUTCFullYear(), l.date.getUTCMonth() + 1);
  const s = await db.journalLine.aggregate({ where: { entityId: l.entityId, accountId: l.accountId, date: { lte: end } }, _sum: { debit: true, credit: true } });
  const net = (s._sum.debit ?? 0n) - (s._sum.credit ?? 0n);
  const own = l.debit - l.credit;
  return own > 0n ? net >= own : net <= own;
}

export const suspenseCorrections = (db: Db, clientId: string, year: number, month: number) => candidates(db, clientId, { year, month });

async function one(db: Db, clientId: string, lineId: string) {
  const [c] = await candidates(db, clientId, { lineId });
  if (!c) throw new LedgerError("Selisih ini tidak ditemukan atau sudah diputuskan.");
  return c;
}

const store = (db: Db, firmId: string, clientId: string, c: SuspenseCorrection) =>
  saveProposal(db, { firmId, clientId, entityId: c.entity.id, year: c.year, month: c.month, source: "SUSPENSE", key: `SUSPENSE:${c.lineId}`, memo: c.memo, lines: c.lines, reason: c.reason, refs: [c.lineId] });

/** The accountant's click: the 1999 line stays fixed, the counter account is theirs to choose. */
export async function postSuspenseCorrection(db: Db, input: { firmId: string; clientId: string; lineId: string; accounts: string[]; actorId?: string | null }) {
  const c = await one(db, input.clientId, input.lineId);
  if (input.accounts[0] !== c.lines[0].accountCode) throw new LedgerError("Baris 1999 tidak bisa diganti akunnya; pilih akun lawan saja.");
  if (!input.accounts[1]?.trim()) throw new LedgerError("Pilih akun untuk setiap baris.");
  if (input.accounts[1] === c.lines[0].accountCode) throw new LedgerError("Akun lawan tidak boleh 1999.");
  const p = await store(db, input.firmId, input.clientId, c);
  // Re-checked inside the posting transaction: two corrections (or a manual one) racing this can't reverse the line twice.
  const guard = async (tx: Tx) => {
    const line = await tx.journalLine.findUniqueOrThrow({ where: { id: c.lineId } });
    if (!(await outstanding(tx, line))) throw new LedgerError("Selisih ini sudah tidak ada di 1999 (sudah dikoreksi); muat ulang halaman.");
  };
  return postProposal(db, { clientId: input.clientId, proposalId: p.id, accounts: input.accounts, actorId: input.actorId, origin: c.origin, guard });
}

/** A 1999 difference must be corrected before the close: its only correction can't be dismissed (there'd be no way to clear it). */
export const SUSPENSE_NOT_DISMISSABLE = "Selisih di 1999 harus dikoreksi sebelum tutup buku: pilih akun lawan lalu catat.";

/** Everything the *Usulan jurnal koreksi* card shows: stored drafts, then this period's undecided 1999 corrections. */
export async function correctionViews(db: Db, clientId: string, year: number, month: number) {
  const suspense = (await suspenseCorrections(db, clientId, year, month)).map((c) => ({ id: `${SUSPENSE_PREFIX}${c.lineId}`, memo: c.memo, reason: c.reason, source: "SUSPENSE" as const, entity: c.entity.shortName, currency: c.entity.functionalCurrency, fixed: 0, lines: c.lines }));
  return [...(await proposalViews(db, clientId, year, month)), ...suspense];
}
