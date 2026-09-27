import type { Db } from "@/lib/db";
import type { NormalBalance } from "@/lib/generated/prisma/enums";
import type { LedgerRow } from "@/components/app/ledger-table";
import { dateOnly, formatDate, formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { formatRateId } from "@/lib/fx/currency";

/**
 * One account's ledger for a month: opening balance, lines with running balance, and the source behind each line
 * (bank row, or file `sheet!row`). Either a Buku account (`accountId`) or one of the client's own accounts
 * (`sourceAccountId`). Balances follow the account's normal side; income & expense start at 1 January.
 */
export async function accountLedger(
  db: Db,
  args: { entityIds: string[]; start: Date; end: Date; normalBalance: NormalBalance; isPL: boolean } & ({ accountId: string } | { sourceAccountId: string }),
): Promise<{ opening: bigint; rows: LedgerRow[] }> {
  const which = "accountId" in args ? { accountId: args.accountId } : { sourceAccountId: args.sourceAccountId };
  const from = args.isPL ? dateOnly(args.start.getUTCFullYear(), 1, 1) : undefined;
  const before = await db.journalLine.aggregate({
    where: { ...which, entityId: { in: args.entityIds }, date: { lt: args.start, gte: from } },
    _sum: { debit: true, credit: true },
  });
  const lines = await db.journalLine.findMany({
    where: { ...which, entityId: { in: args.entityIds }, date: { gte: args.start, lte: args.end } },
    include: {
      entry: {
        include: {
          entity: true,
          lines: { include: { account: true } },
          bankTransaction: { include: { import: true, bankAccount: true } },
          ledgerImport: { select: { fileName: true } },
          postedBy: { select: { name: true } },
        },
      },
      sourceAccount: { select: { code: true, name: true } },
    },
    orderBy: [{ date: "asc" }, { entry: { createdAt: "asc" } }],
  });
  const sign = args.normalBalance === "DEBIT" ? 1n : -1n;
  const opening = ((before._sum.debit ?? 0n) - (before._sum.credit ?? 0n)) * sign;
  const balances = lines.reduce<bigint[]>((acc, l) => [...acc, (acc.at(-1) ?? opening) + (l.debit - l.credit) * sign], []);
  const rows: LedgerRow[] = lines.map((l, idx) => {
    const t = l.entry.bankTransaction;
    return {
      id: l.id,
      date: formatDate(l.date),
      entity: l.entry.entity.shortName,
      memo: l.entry.memo,
      kind: l.entry.kind,
      postedBy: `${l.entry.postedBy?.name ?? "Sistem"} · ${formatDateTime(l.entry.createdAt)}`,
      debit: l.debit.toString(),
      credit: l.credit.toString(),
      balance: balances[idx].toString(),
      entry: { lines: l.entry.lines.map((x) => ({ code: x.account.code, name: x.account.name, debit: x.debit.toString(), credit: x.credit.toString() })) },
      source: t
        ? { fileName: t.import.fileName, rowNumber: t.rowNumber, rawRow: t.rawRow, description: t.description, amount: t.amount.toString(), bank: `${t.bankAccount.label} · ${t.bankAccount.number}`, method: t.method, reason: t.reason, status: t.status }
        : null,
      fileSource: l.entry.ledgerImport
        ? {
            fileName: l.entry.ledgerImport.fileName,
            entryRef: l.entry.sourceRef ?? "",
            lineRef: l.sourceRef,
            sourceAccount: l.sourceAccount ? `${l.sourceAccount.code} ${l.sourceAccount.name}` : null,
            lineMemo: l.memo,
            fx: l.currency && l.fxAmount !== null && l.fxRate ? `${formatMoney(l.fxAmount, l.currency)} × kurs ${formatRateId(l.fxRate)}` : null,
          }
        : null,
    };
  });
  return { opening, rows };
}
