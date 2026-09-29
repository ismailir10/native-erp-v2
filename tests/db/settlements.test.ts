import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { importStatement } from "@/lib/import/pipeline";
import { createInvoice } from "@/lib/receivables/invoices";
import { settle, settleCandidates, settleWithReclass, unsettle } from "@/lib/receivables/settle";
import { reviewTransaction } from "@/lib/review";

type G = Awaited<ReturnType<typeof makeGroup>>;

/** PT Uji's BCA Giro in August (invented): a customer's receipt naming the invoice, another receipt, a payment to a supplier. */
const CSV = [
  "Tanggal;Keterangan;Debet;Kredit;Saldo",
  "20/08/2026;TRSF E-BANKING CR PT MITRA UNGGAS INV-001;0;11100000;111100000",
  "22/08/2026;TRSF E-BANKING CR TOKO SEJAHTERA;0;5000000;116100000",
  "25/08/2026;TRSF E-BANKING DB CV SUMBER MESIN;10000000;0;106100000",
  "",
].join("\n");

async function setup(g: G) {
  await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca.csv", data: Buffer.from(CSV), provider: null });
  const tx = async (text: string) => db.bankTransaction.findFirstOrThrow({ where: { description: { contains: text } } });
  const inv = (number: string, contactName: string, total: string, direction: "SALES" | "PURCHASE" = "SALES") =>
    createInvoice(db, { clientId: g.client.id, entityId: g.pt.entity.id, direction, contactName, number, issueDate: "2026-08-05", dueDate: "2026-09-04", dpp: total, counterCode: direction === "SALES" ? "4100" : "6190" });
  return { tx, inv };
}
const gl = async (g: G, code: string) => {
  const a = await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } });
  const s = await db.journalLine.aggregate({ where: { accountId: a.id }, _sum: { debit: true, credit: true } });
  return (s._sum.debit ?? 0n) - (s._sum.credit ?? 0n);
};

describe("settlements", () => {
  beforeEach(resetDb);

  it("suggests the receipt naming the invoice, then settles it after classifying it to 1130 in one step", async () => {
    const g = await makeGroup();
    const { tx, inv } = await setup(g);
    const a = await inv("INV-001", "PT Mitra Unggas", "11100000");
    const receipt = await tx("MITRA UNGGAS");
    expect(receipt.status).toBe("NEEDS_REVIEW");
    const c = await settleCandidates(db, g.client.id, a.id);
    expect(c.map((x) => [x.description.slice(0, 30), x.exact, x.named, x.onAccount])).toEqual([
      ["TRSF E-BANKING CR PT MITRA UNG", true, true, false],
      ["TRSF E-BANKING CR TOKO SEJAHTE", false, false, false],
    ]);
    await expect(settle(db, { clientId: g.client.id, invoiceId: a.id, bankTransactionId: receipt.id })).rejects.toThrow(/belum dicatat ke 1130/);
    const s = await settleWithReclass(db, { clientId: g.client.id, invoiceId: a.id, bankTransactionId: receipt.id });
    expect(s.amount).toBe(11_100_000n);
    expect(await db.bankTransaction.findUniqueOrThrow({ where: { id: receipt.id } })).toMatchObject({ status: "REVIEWED", accountCode: "1130" });
    expect(await gl(g, "1130")).toBe(0n);
    expect(await settleCandidates(db, g.client.id, a.id)).toEqual([]); // paid
    await expect(settle(db, { clientId: g.client.id, invoiceId: a.id, bankTransactionId: receipt.id })).rejects.toThrow(/sudah lunas/);
  });

  it("settles partially and splits one receipt over two invoices, never beyond either side", async () => {
    const g = await makeGroup();
    const { tx, inv } = await setup(g);
    const bill = await inv("SM-1", "CV Sumber Mesin", "22200000", "PURCHASE");
    const pay = await tx("SUMBER MESIN");
    const part = await settleWithReclass(db, { clientId: g.client.id, invoiceId: bill.id, bankTransactionId: pay.id });
    expect(part.amount).toBe(10_000_000n); // what the payment covers; 12,2 jt stays open
    const receipt = await tx("TOKO SEJAHTERA");
    const x = await inv("T-1", "Toko Sejahtera", "3000000");
    const y = await inv("T-2", "Toko Sejahtera", "4000000");
    await settleWithReclass(db, { clientId: g.client.id, invoiceId: x.id, bankTransactionId: receipt.id });
    await expect(settle(db, { clientId: g.client.id, invoiceId: y.id, bankTransactionId: receipt.id, amount: "2.500.000" })).rejects.toThrow(/Melebihi sisa mutasi/);
    expect((await settle(db, { clientId: g.client.id, invoiceId: y.id, bankTransactionId: receipt.id })).amount).toBe(2_000_000n);
    await expect(settle(db, { clientId: g.client.id, invoiceId: bill.id, bankTransactionId: receipt.id })).rejects.toThrow(/harus uang keluar/);
  });

  it("refuses a closed month and lets a settlement go while the month is open", async () => {
    const g = await makeGroup();
    const { tx, inv } = await setup(g);
    const a = await inv("INV-001", "PT Mitra Unggas", "11100000");
    const s = await settleWithReclass(db, { clientId: g.client.id, invoiceId: a.id, bankTransactionId: (await tx("MITRA UNGGAS")).id });
    await unsettle(db, { clientId: g.client.id, settlementId: s.id });
    expect(await db.invoiceSettlement.count()).toBe(0);
    const again = await settle(db, { clientId: g.client.id, invoiceId: a.id, bankTransactionId: (await tx("MITRA UNGGAS")).id });
    const b = await inv("INV-009", "Toko Sejahtera", "5000000");
    await db.period.upsert({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month: 8 } }, update: { status: "LOCKED" }, create: { firmId: g.firm.id, clientId: g.client.id, year: 2026, month: 8, status: "LOCKED" } });
    await expect(unsettle(db, { clientId: g.client.id, settlementId: again.id })).rejects.toThrow(/sudah ditutup/);
    await expect(settleWithReclass(db, { clientId: g.client.id, invoiceId: b.id, bankTransactionId: (await tx("TOKO SEJAHTERA")).id })).rejects.toThrow(/Agustus 2026 sudah ditutup/);
    expect(await settleCandidates(db, g.client.id, b.id)).toEqual([]);
  });

  it("keeps a settled line on its invoices' account: no reclass away, by matching or by review", async () => {
    const g = await makeGroup();
    const { tx, inv } = await setup(g);
    await db.account.create({ data: { firmId: g.firm.id, clientId: g.client.id, code: "1131", name: "Piutang Usaha Grup", type: "ASET", normalBalance: "DEBIT", fsLine: "PIUTANG_USAHA" } });
    const receipt = await tx("TOKO SEJAHTERA");
    const a = await inv("T-1", "Toko Sejahtera", "3000000");
    const b = await createInvoice(db, { clientId: g.client.id, entityId: g.pt.entity.id, direction: "SALES", contactName: "Toko Sejahtera", number: "T-2", issueDate: "2026-08-05", dpp: "2000000", counterCode: "4100", arApCode: "1131" });
    await settleWithReclass(db, { clientId: g.client.id, invoiceId: a.id, bankTransactionId: receipt.id });
    await expect(settleWithReclass(db, { clientId: g.client.id, invoiceId: b.id, bankTransactionId: receipt.id })).rejects.toThrow(/melunasi T-1 di akun 1130/);
    await expect(reviewTransaction(db, { bankTxId: receipt.id, accountCode: "4100", taxTag: null })).rejects.toThrow(/Hapus pencocokannya dulu/);
    expect(await db.bankTransaction.findUniqueOrThrow({ where: { id: receipt.id } })).toMatchObject({ accountCode: "1130" });
    expect(await db.invoiceSettlement.count()).toBe(1);
  });
});
