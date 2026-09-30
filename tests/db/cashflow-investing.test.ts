import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { postOpening } from "@/lib/opening";
import { createAsset } from "@/lib/assets/register";
import { disposeAsset } from "@/lib/assets/dispose";
import { createInvoice } from "@/lib/receivables/invoices";
import { settleWithReclass } from "@/lib/receivables/settle";
import { importStatement } from "@/lib/import/pipeline";
import { cashFlow } from "@/lib/reports/statements";
import { balanceSheet } from "@/lib/reports/ledger";
import { dateOnly } from "@/lib/format";

type G = Awaited<ReturnType<typeof makeGroup>>;
const J = 1_000_000n;
const id = async (g: G, code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
const post = async (g: G, y: number, m: number, d: number, memo: string, lines: [string, bigint][]) =>
  db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(y, m, d), kind: "ADJUSTMENT", memo, lines: await Promise.all(lines.map(async ([code, v]) => (v > 0n ? { accountId: await id(g, code), debit: v } : { accountId: await id(g, code), credit: -v }))) }));
const scope = (g: G) => ({ clientId: g.client.id, entityIds: [g.pt.entity.id] });
const items = (xs: { key: string; amount: bigint }[]) => xs.map((i) => [i.key, i.amount]);

/** Books start 31 Dec 2025: bank 100 jt, a machine at cost 120 jt with 90 jt accumulated depreciation, capital the rest. */
async function opening(g: G) {
  await postOpening(db, { clientId: g.client.id, entityId: g.pt.entity.id, date: dateOnly(2025, 12, 31), lines: [
    { accountCode: "1120", debit: "100000000", credit: "0" },
    { accountCode: "1210", debit: "120000000", credit: "0" },
    { accountCode: "1219", debit: "0", credit: "90000000" },
    { accountCode: "3100", debit: "0", credit: "130000000" },
  ] });
  return createAsset(db, { clientId: g.client.id, entityId: g.pt.entity.id, name: "Mesin cetak", taxGroup: "KELOMPOK_2", fiscalMethod: "GARIS_LURUS", acquiredOn: "2024-01-01", cost: "120000000", usefulLifeMonths: 48, openingAccumulated: "90000000", remainingMonths: 12, assetAccountCode: "1210", startYear: 2026, startMonth: 2 });
}
const reconciles = async (g: G, cf: Awaited<ReturnType<typeof cashFlow>>, to: Date) => {
  expect(cf.net).toBe(cf.closingCash - cf.openingCash);
  const bs = await balanceSheet(db, scope(g), to);
  expect(bs.currentAssets.find((i) => i.fsLine === "KAS_SETARA_KAS")?.amount).toBe(cf.closingCash);
};

describe("cash flow: disposal proceeds and capex on a payable in investing", () => {
  beforeEach(resetDb);

  it("shows the collected proceeds of a disposal (cost 120 jt, accumulated 90 jt, sold 40 jt) as +40 jt investing", async () => {
    const g = await makeGroup();
    const a = await opening(g);
    const r = await disposeAsset(db, { clientId: g.client.id, assetId: a.id, date: "2026-01-20", proceeds: "40000000", proceedsCode: "1140" });
    expect(r).toMatchObject({ accumulated: 90n * J, bookValue: 30n * J, result: 10n * J });
    await post(g, 2026, 2, 10, "Penerimaan hasil penjualan mesin", [["1120", 40n * J], ["1140", -40n * J]]);
    const cf = await cashFlow(db, scope(g), dateOnly(2026, 12, 31));
    expect(cf.netProfit).toBe(10n * J);
    expect(items(cf.investing)).toEqual([["DISPOSAL", 40n * J]]);
    expect(cf.totals).toEqual({ OPERATING: 0n, INVESTING: 40n * J, FINANCING: 0n });
    expect([cf.openingCash, cf.net, cf.closingCash]).toEqual([100n * J, 40n * J, 140n * J]);
    await reconciles(g, cf, dateOnly(2026, 12, 31));
  });

  it("does not call proceeds still receivable at the period end an inflow", async () => {
    const g = await makeGroup();
    const a = await opening(g);
    await disposeAsset(db, { clientId: g.client.id, assetId: a.id, date: "2026-01-20", proceeds: "40000000", proceedsCode: "1140" });
    await post(g, 2026, 2, 10, "Penerimaan sebagian", [["1120", 15n * J], ["1140", -15n * J]]);
    const cf = await cashFlow(db, scope(g), dateOnly(2026, 12, 31));
    expect(items(cf.investing)).toEqual([["DISPOSAL", 15n * J]]); // 25 jt is still a receivable
    expect(cf.net).toBe(15n * J);
    await reconciles(g, cf, dateOnly(2026, 12, 31));
    const early = await cashFlow(db, scope(g), dateOnly(2026, 1, 31)); // nothing collected yet
    expect(early.investing).toEqual([]);
    expect(early.net).toBe(0n);
    await reconciles(g, early, dateOnly(2026, 1, 31));
  });

  it("shows equipment bought on a payable and paid from the bank as investing, in the year of purchase and after", async () => {
    const g = await makeGroup();
    await opening(g);
    const csv = ["Tanggal;Keterangan;Debet;Kredit;Saldo", "15/02/2026;TRSF E-BANKING DB CV MESIN MAJU CICILAN 1;30000000;0;70000000", "15/03/2026;TRSF E-BANKING DB CV MESIN MAJU CICILAN 2;20000000;0;50000000", ""].join("\n");
    await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca.csv", data: Buffer.from(csv), provider: null });
    // a Rp 80 jt bill of January 2026, paid in two instalments
    const bill = (number: string, issueDate: string, dpp: string) => createInvoice(db, { clientId: g.client.id, entityId: g.pt.entity.id, direction: "PURCHASE", contactName: "CV Mesin Maju", number, issueDate, dpp, counterCode: "1210" });
    const b1 = await bill("MM-1", "2026-01-10", "80.000.000");
    const line = (text: string) => db.bankTransaction.findFirstOrThrow({ where: { description: { contains: text } } });
    await settleWithReclass(db, { clientId: g.client.id, invoiceId: b1.id, bankTransactionId: (await line("CICILAN 1")).id });
    await settleWithReclass(db, { clientId: g.client.id, invoiceId: b1.id, bankTransactionId: (await line("CICILAN 2")).id });
    const cf = await cashFlow(db, scope(g), dateOnly(2026, 12, 31));
    expect(items(cf.investing)).toEqual([["ASET_TETAP", -50n * J]]); // 50 jt paid of the 80 jt bill
    expect(cf.operating.find((i) => i.key === "UTANG_USAHA")!.amount + (cf.operating.find((i) => i.key === "NONCASH")?.amount ?? 0n)).toBe(0n);
    expect(cf.totals).toEqual({ OPERATING: 0n, INVESTING: -50n * J, FINANCING: 0n });
    await reconciles(g, cf, dateOnly(2026, 12, 31));
  });

  it("counts a payment in the next year against last year's bill as investing too", async () => {
    const g = await makeGroup();
    await opening(g);
    const bill = await createInvoice(db, { clientId: g.client.id, entityId: g.pt.entity.id, direction: "PURCHASE", contactName: "CV Mesin Maju", number: "MM-9", issueDate: "2026-12-10", dpp: "60.000.000", counterCode: "1210" });
    const csv = ["Tanggal;Keterangan;Debet;Kredit;Saldo", "15/01/2027;TRSF E-BANKING DB CV MESIN MAJU MM-9;60000000;0;40000000", ""].join("\n");
    await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca.csv", data: Buffer.from(csv), provider: null });
    await settleWithReclass(db, { clientId: g.client.id, invoiceId: bill.id, bankTransactionId: (await db.bankTransaction.findFirstOrThrow({ where: { description: { contains: "MM-9" } } })).id });
    const y1 = await cashFlow(db, scope(g), dateOnly(2026, 12, 31));
    expect(y1.investing).toEqual([]); // bought on credit: nothing paid yet
    expect(y1.net).toBe(0n);
    const y2 = await cashFlow(db, scope(g), dateOnly(2027, 12, 31));
    expect(items(y2.investing)).toEqual([["ASET_TETAP", -60n * J]]);
    expect(y2.totals.OPERATING).toBe(0n);
    await reconciles(g, y2, dateOnly(2027, 12, 31));
    await reconciles(g, y1, dateOnly(2026, 12, 31));
  });
  it("counts only the cash of a bill settled with withholding as investing (50 jt bill: 45 jt bank + 5 jt PPh 23 withheld)", async () => {
    const g = await makeGroup();
    await opening(g);
    const bill = await createInvoice(db, { clientId: g.client.id, entityId: g.pt.entity.id, direction: "PURCHASE", contactName: "CV Mesin Maju", number: "MM-5", issueDate: "2026-03-01", dpp: "50.000.000", counterCode: "1210", whtKind: "PPH_23", whtAmount: "5.000.000" });
    const csv = ["Tanggal;Keterangan;Debet;Kredit;Saldo", "15/03/2026;TRSF E-BANKING DB CV MESIN MAJU MM-5;45000000;0;55000000", ""].join("\n");
    await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca.csv", data: Buffer.from(csv), provider: null });
    const s = await settleWithReclass(db, { clientId: g.client.id, invoiceId: bill.id, bankTransactionId: (await db.bankTransaction.findFirstOrThrow({ where: { description: { contains: "MM-5" } } })).id });
    expect(s).toMatchObject({ amount: 50n * J, withheld: 5n * J });
    const cf = await cashFlow(db, scope(g), dateOnly(2026, 12, 31));
    expect(items(cf.investing)).toEqual([["ASET_TETAP", -45n * J]]); // only what left the bank
    expect(cf.totals).toEqual({ OPERATING: 0n, INVESTING: -45n * J, FINANCING: 0n });
    expect(cf.net).toBe(-45n * J);
    await reconciles(g, cf, dateOnly(2026, 12, 31));
  });
});
