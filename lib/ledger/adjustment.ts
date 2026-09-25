import type { Db } from "@/lib/db";
import { LedgerError, postJournal } from "@/lib/ledger/post";
import { parseMoney } from "@/lib/money";

export type AdjustmentLineInput = { accountCode: string; debit: string; credit: string };

/**
 * Jurnal Penyesuaian: one typed ADJUSTMENT entry, posted through postJournal(). Amounts are typed in major units of
 * the entity's functional currency (read here, never taken from the client) and posted as minor units (rule 6).
 */
export async function postAdjustment(db: Db, input: { clientId: string; entityId: string; date: Date; memo: string; lines: AdjustmentLineInput[] }) {
  const entity = await db.entity.findFirst({ where: { id: input.entityId, clientId: input.clientId } });
  if (!entity) throw new LedgerError("Pilih entitas.");
  const memo = input.memo.trim();
  if (!memo) throw new LedgerError("Isi keterangan jurnal.");
  const accounts = new Map((await db.account.findMany({ where: { clientId: input.clientId } })).map((a) => [a.code, a]));
  const lines = input.lines
    .filter((l) => l.accountCode)
    .map((l) => {
      const a = accounts.get(l.accountCode);
      if (!a) throw new LedgerError(`Akun ${l.accountCode} tidak ditemukan`);
      return { accountId: a.id, debit: parseMoney(l.debit, entity.functionalCurrency), credit: parseMoney(l.credit, entity.functionalCurrency) };
    });
  return db.$transaction((tx) => postJournal(tx, { entityId: entity.id, date: input.date, kind: "ADJUSTMENT", memo, lines }));
}
