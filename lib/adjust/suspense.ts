import type { Db } from "@/lib/db";
import { LedgerError } from "@/lib/ledger/post";
import { formatDate, periodBounds } from "@/lib/format";
import { SOURCE_DIFFERENCE_MEMO } from "@/lib/ledger-import/post";
import { dismissProposal, postProposal, proposalViews, saveProposal, type ProposalLine } from "@/lib/adjust/proposals";

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
  // Only a decision hides a line; an open draft (a post that failed, e.g. locked period) is reused on the next click.
  const decided = new Set((await db.proposedEntry.findMany({ where: { key: { in: lines.map((l) => `SUSPENSE:${l.id}`) }, status: { not: "PROPOSED" } }, select: { key: true } })).map((p) => p.key));
  return lines.flatMap((l) => {
    if (decided.has(`SUSPENSE:${l.id}`)) return [];
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
  return postProposal(db, { clientId: input.clientId, proposalId: p.id, accounts: input.accounts, actorId: input.actorId, origin: c.origin });
}

export async function dismissSuspenseCorrection(db: Db, input: { firmId: string; clientId: string; lineId: string; actorId?: string | null }) {
  const c = await one(db, input.clientId, input.lineId);
  const p = await store(db, input.firmId, input.clientId, c);
  await dismissProposal(db, { clientId: input.clientId, proposalId: p.id, actorId: input.actorId });
}

/** Everything the *Usulan jurnal koreksi* card shows: stored drafts, then this period's undecided 1999 corrections. */
export async function correctionViews(db: Db, clientId: string, year: number, month: number) {
  const suspense = (await suspenseCorrections(db, clientId, year, month)).map((c) => ({ id: `${SUSPENSE_PREFIX}${c.lineId}`, memo: c.memo, reason: c.reason, source: "SUSPENSE" as const, entity: c.entity.shortName, currency: c.entity.functionalCurrency, fixed: 0, lines: c.lines }));
  return [...(await proposalViews(db, clientId, year, month)), ...suspense];
}
