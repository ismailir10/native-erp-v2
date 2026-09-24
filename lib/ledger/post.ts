import type { Tx } from "@/lib/db";
import type { EntryKind } from "@/lib/generated/prisma/enums";
import { formatPeriod } from "@/lib/format";

/**
 * The ONLY writer of JournalEntry/JournalLine. Enforces (accounting-rules):
 *  1. Σdebit = Σcredit, ≥ 2 lines, each line exactly one positive side (also DB CHECK)
 *  2. period open (locked periods reject every write)
 *  3. every account belongs to the entity's client COA
 * Posted entries are immutable — corrections go through a new RECLASS/ADJUSTMENT entry.
 */
export class LedgerError extends Error {}

export type PostLine = { accountId: string; debit?: bigint; credit?: bigint; memo?: string };

export type PostInput = {
  entityId: string;
  date: Date;
  kind: EntryKind;
  memo: string;
  bankTransactionId?: string;
  lines: PostLine[];
};

export async function getOrCreatePeriod(tx: Tx, firmId: string, clientId: string, date: Date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return tx.period.upsert({
    where: { clientId_year_month: { clientId, year, month } },
    create: { firmId, clientId, year, month },
    update: {},
  });
}

/** Merge lines on the same account+side and drop zero lines. Keeps entries compact. */
function normalizeLines(lines: PostLine[]) {
  const out: { accountId: string; debit: bigint; credit: bigint; memo?: string }[] = [];
  for (const l of lines) {
    const debit = l.debit ?? 0n;
    const credit = l.credit ?? 0n;
    if (debit < 0n || credit < 0n) throw new LedgerError("Nominal debit/kredit tidak boleh negatif");
    if (debit > 0n && credit > 0n) throw new LedgerError("Satu baris jurnal hanya boleh debit ATAU kredit");
    if (debit === 0n && credit === 0n) continue;
    out.push({ accountId: l.accountId, debit, credit, memo: l.memo });
  }
  return out;
}

export async function postJournal(tx: Tx, input: PostInput) {
  const lines = normalizeLines(input.lines);
  if (lines.length < 2) throw new LedgerError("Jurnal minimal dua baris");
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0n);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0n);
  if (totalDebit !== totalCredit) {
    throw new LedgerError(`Jurnal tidak seimbang: debit ${totalDebit} ≠ kredit ${totalCredit}`);
  }

  const entity = await tx.entity.findUniqueOrThrow({ where: { id: input.entityId } });
  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  const accounts = await tx.account.findMany({ where: { id: { in: accountIds } } });
  if (accounts.length !== accountIds.length || accounts.some((a) => a.clientId !== entity.clientId)) {
    throw new LedgerError("Akun tidak termasuk bagan akun klien ini");
  }

  const period = await getOrCreatePeriod(tx, entity.firmId, entity.clientId, input.date);
  if (period.status === "LOCKED") {
    throw new LedgerError(`Periode ${formatPeriod(period.year, period.month)} sudah ditutup`);
  }

  return tx.journalEntry.create({
    data: {
      firmId: entity.firmId,
      entityId: entity.id,
      periodId: period.id,
      date: input.date,
      kind: input.kind,
      memo: input.memo,
      bankTransactionId: input.bankTransactionId,
      lines: {
        create: lines.map((l) => ({
          firmId: entity.firmId,
          entityId: entity.id,
          accountId: l.accountId,
          date: input.date,
          debit: l.debit,
          credit: l.credit,
          memo: l.memo,
        })),
      },
    },
    include: { lines: true },
  });
}
