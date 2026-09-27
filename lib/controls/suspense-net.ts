import type { Db, Tx } from "@/lib/db";

/**
 * An entity's 1999 balance through `end` from everything except bank lines: a bank line sits on 1999 only while it waits in
 * Review (rule 3, the `suspense` control), so what remains is accepted source differences and their corrections (rule 15a).
 * Signed: debit − credit, minor units.
 */
export async function sourceSuspenseNet(db: Db | Tx, entityId: string, end: Date): Promise<bigint> {
  const s = await db.journalLine.aggregate({
    where: { entityId, account: { isSuspense: true }, date: { lte: end }, entry: { bankTransactionId: null } },
    _sum: { debit: true, credit: true },
  });
  return (s._sum.debit ?? 0n) - (s._sum.credit ?? 0n);
}
