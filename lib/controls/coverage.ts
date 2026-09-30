import type { Db, Tx } from "@/lib/db";

/**
 * Whether a bank account's statements cover a month (rule 22): imported ("covered", with the files), not needed yet because the books start
 * after the month ("before", from the day they start — the day after the entity's Saldo Awal, else the account's first statement), or
 * "missing". Shared by the bank reconciliation control and the report status so both say the same.
 */
export async function statementCoverage(db: Db | Tx, bankAccountId: string, opening: Date | null, start: Date, end: Date) {
  const coverage = await db.statementImport.findMany({ where: { bankAccountId, periodStart: { lte: end }, periodEnd: { gte: start } } });
  if (coverage.length) return { state: "covered" as const, coverage };
  const first = opening ? null : await db.statementImport.findFirst({ where: { bankAccountId }, orderBy: { periodStart: "asc" }, select: { periodStart: true } });
  const startsAfter = opening ? end.getTime() <= opening.getTime() : !!first && end.getTime() < first.periodStart.getTime();
  if (startsAfter) return { state: "before" as const, from: opening ? new Date(opening.getTime() + 86_400_000) : first!.periodStart };
  return { state: "missing" as const };
}

/** The date of the entity's first Saldo Awal entry, if any. */
export async function openingDate(db: Db | Tx, entityId: string) {
  return (await db.journalEntry.findFirst({ where: { entityId, kind: "OPENING" }, orderBy: { date: "asc" }, select: { date: true } }))?.date ?? null;
}
