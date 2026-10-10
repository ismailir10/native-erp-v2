import type { Tx } from "@/lib/db";
import type { BankTransaction } from "@/lib/generated/prisma/client";
import { ParseError } from "@/lib/import/types";

/** Lock before posting any journals (review/split writers also take the bank-row lock before ledger locks).
 * Classification happens outside the write transaction. A selected half must still be exactly the row that was classified:
 * another import, a manual review, split or settlement may have consumed it while classification was running.
 */
export async function guardTransferCounterparts(tx: Tx, clientId: string, snapshots: BankTransaction[]): Promise<void> {
  const selected = [...new Map(snapshots.map((row) => [row.id, row])).values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const row of selected) await tx.$queryRaw`SELECT id FROM "BankTransaction" WHERE id = ${row.id} FOR UPDATE`;
  if (!selected.length) return;
  const current = await tx.bankTransaction.findMany({
    where: { id: { in: selected.map((row) => row.id) }, bankAccount: { entity: { clientId } } },
    include: { _count: { select: { splits: true, settlements: true } } },
  });
  const byId = new Map(current.map((row) => [row.id, row]));
  const fields = ["firmId", "bankAccountId", "entityId", "description", "direction", "amount", "accountCode", "suggestedCode", "status", "method", "confidence", "reason", "taxTag", "whtKind", "whtAmount", "contactId"] as const;
  for (const before of selected) {
    const after = byId.get(before.id);
    if (!after || after.matchedTxId !== null || after.pairRefused || after._count.splits || after._count.settlements ||
      fields.some((key) => before[key] !== after[key]) || +before.date !== +after.date || before.taxMonth?.getTime() !== after.taxMonth?.getTime()) {
      throw new ParseError("Calon pasangan transfer baru saja berubah atau sudah digunakan. Tidak ada mutasi yang diimpor; ulangi impor agar pasangan diperiksa kembali.");
    }
  }
}
