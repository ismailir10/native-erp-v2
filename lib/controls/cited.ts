import type { Db, Tx } from "@/lib/db";

/**
 * The bank lines a draft's citations point at: bank rows cited directly, and the bank line behind a cited journal line (`jl:`) or
 * entry (`je:`), as the ledger anomaly scans cite them, so a bank-derived row is never mistaken for a free journal (rule 20b).
 */
export async function citedBankIds(db: Db | Tx, entityId: string, citedIds: string[]): Promise<string[]> {
  const ids = (prefix: string) => citedIds.filter((r) => r.startsWith(prefix)).map((r) => r.slice(prefix.length));
  const [lines, entries] = await Promise.all([
    db.journalLine.findMany({ where: { id: { in: ids("jl:") }, entityId }, select: { entry: { select: { bankTransactionId: true } } } }),
    db.journalEntry.findMany({ where: { id: { in: ids("je:") }, entityId }, select: { bankTransactionId: true } }),
  ]);
  const behind = [...lines.map((l) => l.entry.bankTransactionId), ...entries.map((e) => e.bankTransactionId)];
  return [...new Set([...citedIds, ...behind.filter((id): id is string => !!id)])];
}
