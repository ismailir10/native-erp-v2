import type { Db } from "@/lib/db";
import type { Scope } from "@/lib/reports/ledger";

/** Light tax view for a month. ESTIMATE only — not an SPT, no e-Faktur/Coretax. */
export async function taxSummary(db: Db, scope: Scope, from: Date, to: Date) {
  const accounts = await db.account.findMany({ where: { clientId: scope.clientId, code: { in: ["2130", "1150", "8200"] } } });
  const id = (c: string) => accounts.find((a) => a.code === c)?.id ?? "";
  const sum = async (accountId: string) =>
    (await db.journalLine.aggregate({ where: { accountId, entityId: { in: scope.entityIds }, date: { gte: from, lte: to } }, _sum: { debit: true, credit: true } }))._sum;
  const [ppnK, ppnM, pph42] = await Promise.all([sum(id("2130")), sum(id("1150")), sum(id("8200"))]);
  const pph21 = await db.bankTransaction.aggregate({ where: { entityId: { in: scope.entityIds }, taxTag: "PPH_21", date: { gte: from, lte: to } }, _sum: { amount: true } });
  const keluaran = ppnK.credit ?? 0n;
  const masukan = ppnM.debit ?? 0n;
  return {
    ppnKeluaran: keluaran,
    ppnMasukan: masukan,
    ppnNet: keluaran - masukan,
    ppnDisetor: ppnK.debit ?? 0n,
    pph42: pph42.debit ?? 0n,
    pph21: -(pph21._sum.amount ?? 0n),
  };
}
