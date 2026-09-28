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

/**
 * Per bank line, every non-bank account its postings use: its classification, any tax split (PPN/PPh) and the suspense account it
 * passed through. A draft touching any of them moves that bank line, which only the reviewer's writer may do (rule 3).
 */
export async function bankLineAccounts(db: Db | Tx, txs: { id: string; accountCode: string | null }[]): Promise<Map<string, Set<string>>> {
  const out = new Map(txs.map((t) => [t.id, new Set(t.accountCode ? [t.accountCode] : [])]));
  const lines = await db.journalLine.findMany({
    where: { entry: { bankTransactionId: { in: txs.map((t) => t.id) } }, account: { isBank: false } },
    select: { account: { select: { code: true } }, entry: { select: { bankTransactionId: true } } },
  });
  for (const l of lines) out.get(l.entry.bankTransactionId!)?.add(l.account.code);
  return out;
}
