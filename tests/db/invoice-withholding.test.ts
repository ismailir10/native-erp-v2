import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { importStatement } from "@/lib/import/pipeline";
import { createInvoice } from "@/lib/receivables/invoices";
import { settle, settleCandidates, settleWithReclass, unsettle } from "@/lib/receivables/settle";
import { runControls } from "@/lib/controls";
import { invoicesAt } from "@/lib/receivables/aging";
import { reviewTransaction } from "@/lib/review";
import { dateOnly } from "@/lib/format";

type G = Awaited<ReturnType<typeof makeGroup>>;

/** PT Uji's BCA Giro in August (invented): a customer pays 10,9 jt against 11,1 jt (PPh 23 withheld), we pay a supplier 10,9 jt against 11,1 jt. */
const CSV = [
  "Tanggal;Keterangan;Debet;Kredit;Saldo",
  "20/08/2026;TRSF E-BANKING CR PT MITRA JASA INV-001;0;10900000;110900000",
  "25/08/2026;TRSF E-BANKING DB CV KONSULTAN BAYU B-77;10900000;0;100000000",
  "",
].join("\n");

const gl = async (g: G, code: string) => {
  const a = await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } });
  const s = await db.journalLine.aggregate({ where: { accountId: a.id }, _sum: { debit: true, credit: true } });
  return (s._sum.debit ?? 0n) - (s._sum.credit ?? 0n);
};
const setup = async (g: G) => {
  await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca.csv", data: Buffer.from(CSV), provider: null });
  return (text: string) => db.bankTransaction.findFirstOrThrow({ where: { description: { contains: text } } });
};
const sale = (g: G, over: Partial<Parameters<typeof createInvoice>[1]> = {}) =>
  createInvoice(db, { clientId: g.client.id, entityId: g.pt.entity.id, direction: "SALES", contactName: "PT Mitra Jasa", number: "INV-001", issueDate: "2026-08-05", dueDate: "2026-09-04", dpp: "10.000.000", ppn: "1.100.000", counterCode: "4100", whtKind: "PPH_23", whtRate: "2", ...over });
const control = async (g: G, key: "ar" | "ap") => (await runControls(db, g.client.id, 2026, 8)).find((c) => c.key === `${key}:${g.pt.entity.id}`);

describe("withholding on invoices", () => {
  beforeEach(resetDb);

  it("customer withholds PPh 23: Dr Bank 10,9 jt + Dr 1180 200.000 / Cr 1130 11,1 jt, the receivable closes at gross", async () => {
    const g = await makeGroup();
    const tx = await setup(g);
    const inv = await sale(g);
    expect(inv).toMatchObject({ dpp: 10_000_000n, ppn: 1_100_000n, total: 11_100_000n, whtKind: "PPH_23", whtAmount: 200_000n });
    expect(await gl(g, "1130")).toBe(11_100_000n); // posted at gross
    const receipt = await tx("MITRA JASA");
    // The settlement suggestion still finds the line (it is short by exactly the withholding).
    expect((await settleCandidates(db, g.client.id, inv.id)).map((c) => c.bankTransactionId)).toContain(receipt.id);
    const s = await settleWithReclass(db, { clientId: g.client.id, invoiceId: inv.id, bankTransactionId: receipt.id });
    expect(s).toMatchObject({ amount: 11_100_000n, withheld: 200_000n });
    expect(await db.bankTransaction.findUniqueOrThrow({ where: { id: receipt.id } })).toMatchObject({ whtKind: "PPH_23", whtAmount: 200_000n, accountCode: "1130" });
    expect(await gl(g, "1180")).toBe(200_000n);
    expect(await gl(g, "1130")).toBe(0n);
    const [item] = await invoicesAt(db, g.client.id, "SALES", dateOnly(2026, 8, 31));
    expect(item).toMatchObject({ total: 11_100_000n, settled: 11_100_000n, open: 0n });
    expect(await control(g, "ar")).toMatchObject({ status: "PASS" });
    // the receipt's entries: bank Dr 10,9 jt, 1180 Dr 200.000, 1130 Cr 11,1 jt in all, each with its bank row
    const lines = await db.journalLine.findMany({ where: { entry: { bankTransactionId: receipt.id } }, include: { account: true } });
    const net = new Map<string, bigint>();
    for (const l of lines) net.set(l.account.code, (net.get(l.account.code) ?? 0n) + l.debit - l.credit);
    expect(Object.fromEntries(net)).toEqual({ "1101": 10_900_000n, "1180": 200_000n, "1130": -11_100_000n, "1999": 0n });
  });

  it("we withhold PPh 23 on a supplier's bill: Cr bank 10,9 jt + Cr 2141 200.000 clear the payable at gross; ap: passes", async () => {
    const g = await makeGroup();
    const tx = await setup(g);
    const bill = await createInvoice(db, { clientId: g.client.id, entityId: g.pt.entity.id, direction: "PURCHASE", contactName: "CV Konsultan Bayu", number: "B-77", issueDate: "2026-08-10", dueDate: "2026-09-10", dpp: "10.000.000", ppn: "1.100.000", counterCode: "6170", whtKind: "PPH_23", whtAmount: "200.000" });
    expect(bill.whtAmount).toBe(200_000n);
    const s = await settleWithReclass(db, { clientId: g.client.id, invoiceId: bill.id, bankTransactionId: (await tx("KONSULTAN BAYU")).id });
    expect(s).toMatchObject({ amount: 11_100_000n, withheld: 200_000n });
    expect(await gl(g, "2110")).toBe(0n);
    expect(await gl(g, "2141")).toBe(-200_000n);
    expect(await control(g, "ap")).toMatchObject({ status: "PASS" });
  });

  it("books the expected withholding only when the settlement closes the invoice; a partial payment does not; unsettle takes it back", async () => {
    const g = await makeGroup();
    const tx = await setup(g);
    const inv = await sale(g);
    const receipt = await tx("MITRA JASA");
    await reviewTransaction(db, { bankTxId: receipt.id, accountCode: "1130", taxTag: null });
    const part = await settle(db, { clientId: g.client.id, invoiceId: inv.id, bankTransactionId: receipt.id, amount: "5.000.000" });
    expect(part).toMatchObject({ amount: 5_000_000n, withheld: 0n });
    expect(await gl(g, "1180")).toBe(0n);
    await unsettle(db, { clientId: g.client.id, settlementId: part.id });
    const full = await settle(db, { clientId: g.client.id, invoiceId: inv.id, bankTransactionId: receipt.id });
    expect(full).toMatchObject({ amount: 11_100_000n, withheld: 200_000n });
    expect(await gl(g, "1180")).toBe(200_000n);
    await unsettle(db, { clientId: g.client.id, settlementId: full.id });
    expect(await gl(g, "1180")).toBe(0n);
    expect(await gl(g, "1130")).toBe(200_000n); // 11,1 jt billed, 10,9 jt received: 200.000 open again
    expect(await db.bankTransaction.findUniqueOrThrow({ where: { id: receipt.id } })).toMatchObject({ whtKind: null, whtAmount: 0n });
    // paid in full without a withholding: nothing is booked
    const gross = await settle(db, { clientId: g.client.id, invoiceId: inv.id, bankTransactionId: receipt.id, withheld: "0" });
    expect(gross).toMatchObject({ amount: 10_900_000n, withheld: 0n });
  });

  it("checks the withholding on the invoice and on the settlement", async () => {
    const g = await makeGroup();
    const tx = await setup(g);
    await expect(sale(g, { whtRate: "abc" })).rejects.toThrow(/Tarif/);
    await expect(sale(g, { whtRate: null, whtAmount: "10.000.001" })).rejects.toThrow(/melebihi DPP/);
    await expect(sale(g, { whtKind: "PPH_21" })).rejects.toThrow(/hanya bisa dipotong/);
    await expect(sale(g, { whtKind: null, whtRate: "2" })).rejects.toThrow(/jenis pajak/);
    const plain = await sale(g, { whtKind: null, whtRate: null });
    expect(plain.whtAmount).toBe(0n);
    const receipt = await tx("MITRA JASA");
    // a settlement can name the tax when the invoice didn't
    const s = await settleWithReclass(db, { clientId: g.client.id, invoiceId: plain.id, bankTransactionId: receipt.id, whtKind: "PPH_23", withheld: "200.000" });
    expect(s).toMatchObject({ amount: 11_100_000n, withheld: 200_000n });
    // a line that carries withholding from a settlement can't be given another one by hand
    await expect(reviewTransaction(db, { bankTxId: receipt.id, accountCode: "1130", taxTag: null, withholding: { kind: "PPH_23", amount: 1n } })).rejects.toThrow(/pencocokan faktur/);
  });
});
