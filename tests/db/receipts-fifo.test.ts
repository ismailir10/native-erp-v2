import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { importStatement } from "@/lib/import/pipeline";
import { createInvoice } from "@/lib/receivables/invoices";
import { settle, settleFifo, settleWithReclass, tagAdvance } from "@/lib/receivables/settle";
import { subledgerVsLedger } from "@/lib/receivables/aging";
import { receivablesView } from "@/lib/receivables/view";
import { runControls } from "@/lib/controls";
import { reviewTransaction, splitTransaction } from "@/lib/review";
import { dateOnly } from "@/lib/format";
import { compareSubledger, importAging } from "@/lib/reconcile/subledger";

type G = Awaited<ReturnType<typeof makeGroup>>;

/** PT Uji's BCA Giro in August (invented): one reseller's receipt larger than two notes, another customer's, a supplier payment. */
const CSV = [
  "Tanggal;Keterangan;Debet;Kredit;Saldo",
  "20/08/2026;TRSF E-BANKING CR TOKO SEJAHTERA;0;9000000;109000000",
  "22/08/2026;TRSF E-BANKING CR PT MITRA JASA;0;10900000;119900000",
  "25/08/2026;TRSF E-BANKING DB CV SUMBER MESIN;4000000;0;115900000",
  "",
].join("\n");

async function setup(g: G) {
  await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca.csv", data: Buffer.from(CSV), provider: null });
  const tx = async (text: string) => db.bankTransaction.findFirstOrThrow({ where: { description: { contains: text } } });
  const inv = (number: string, contactName: string, dpp: string, dueDate: string, more: Record<string, string> = {}, direction: "SALES" | "PURCHASE" = "SALES") =>
    createInvoice(db, { clientId: g.client.id, entityId: g.pt.entity.id, direction, contactName, number, issueDate: "2026-08-01", dueDate, dpp, counterCode: direction === "SALES" ? "4100" : "6190", ...more });
  return { tx, inv };
}

describe("receipts against notes (FIFO)", () => {
  beforeEach(resetDb);

  it("pays the oldest due notes first, classifies a line in Review first, and keeps the rest on the tagged line", async () => {
    const g = await makeGroup();
    const { tx, inv } = await setup(g);
    const late = await inv("N-3", "Toko Sejahtera", "3000000", "2026-09-15");
    const early = await inv("N-1", "Toko Sejahtera", "2000000", "2026-08-10");
    const mid = await inv("N-2", "Toko Sejahtera", "2500000", "2026-08-31");
    const receipt = await tx("TOKO SEJAHTERA");
    expect(receipt.status).toBe("NEEDS_REVIEW");
    const r = await settleFifo(db, { clientId: g.client.id, bankTransactionId: receipt.id, contactId: early.contactId });
    expect(r.settled.map((s) => [s.number, s.amount])).toEqual([["N-1", 2_000_000n], ["N-2", 2_500_000n], ["N-3", 3_000_000n]]);
    expect(r.rest).toBe(1_500_000n); // overpayment: the reseller's advance, not lost
    const after = await db.bankTransaction.findUniqueOrThrow({ where: { id: receipt.id } });
    expect(after).toMatchObject({ status: "REVIEWED", accountCode: "1130", contactId: early.contactId });
    for (const i of [late, early, mid]) expect((await db.invoiceSettlement.aggregate({ where: { invoiceId: i.id }, _sum: { amount: true } }))._sum.amount).toBe(i.total);
    // Nothing left to pay: the next FIFO says so and points to the advance.
    await expect(settleFifo(db, { clientId: g.client.id, bankTransactionId: receipt.id, contactId: early.contactId })).rejects.toThrow(/Tidak ada faktur terbuka untuk Toko Sejahtera/);
  });

  it("stops when the line runs out, leaving the later note partly open", async () => {
    const g = await makeGroup();
    const { tx, inv } = await setup(g);
    const a = await inv("N-1", "Toko Sejahtera", "6000000", "2026-08-10");
    const b = await inv("N-2", "Toko Sejahtera", "6000000", "2026-08-20");
    const r = await settleFifo(db, { clientId: g.client.id, bankTransactionId: (await tx("TOKO SEJAHTERA")).id, contactId: a.contactId });
    expect(r.settled.map((s) => [s.number, s.amount])).toEqual([["N-1", 6_000_000n], ["N-2", 3_000_000n]]);
    expect(r.rest).toBe(0n);
    expect((await db.invoiceSettlement.aggregate({ where: { invoiceId: b.id }, _sum: { amount: true } }))._sum.amount).toBe(3_000_000n);
    await expect(settleFifo(db, { clientId: g.client.id, bankTransactionId: (await tx("TOKO SEJAHTERA")).id, contactId: a.contactId })).rejects.toThrow(/habis dicocokkan/);
  });

  it("closes a withholding invoice at its net with the tax booked, as by hand", async () => {
    const g = await makeGroup();
    const { tx, inv } = await setup(g);
    const a = await inv("INV-1", "PT Mitra Jasa", "10.000.000", "2026-08-31", { ppn: "1.100.000", whtKind: "PPH_23", whtRate: "2" });
    expect(a.whtAmount).toBe(200_000n);
    const r = await settleFifo(db, { clientId: g.client.id, bankTransactionId: (await tx("MITRA JASA")).id, contactId: a.contactId });
    expect(r.settled).toEqual([{ number: "INV-1", amount: 11_100_000n }]); // 10,9 jt cash + 200 rb PPh 23
    expect(r.rest).toBe(0n);
    const s = await db.invoiceSettlement.findFirstOrThrow({ where: { invoiceId: a.id } });
    expect([s.amount, s.withheld]).toEqual([11_100_000n, 200_000n]);
    expect(await db.bankTransaction.findFirstOrThrow({ where: { description: { contains: "MITRA JASA" } } })).toMatchObject({ whtKind: "PPH_23", whtAmount: 200_000n });
  });

  it("refuses a contact without open notes, mixed accounts, a wrong direction; tags and untags an advance", async () => {
    const g = await makeGroup();
    const { tx, inv } = await setup(g);
    const bill = await inv("B-1", "CV Sumber Mesin", "5000000", "2026-08-31", {}, "PURCHASE");
    const receipt = await tx("TOKO SEJAHTERA");
    // A supplier's bill cannot take a receipt: FIFO looks for the contact's sales notes only.
    await expect(settleFifo(db, { clientId: g.client.id, bankTransactionId: receipt.id, contactId: bill.contactId })).rejects.toThrow(/Tidak ada faktur terbuka untuk CV Sumber Mesin/);
    const pay = await settleFifo(db, { clientId: g.client.id, bankTransactionId: (await tx("SUMBER MESIN")).id, contactId: bill.contactId });
    expect(pay.settled).toEqual([{ number: "B-1", amount: 4_000_000n }]);
    const a = await inv("N-1", "Toko Sejahtera", "1000000", "2026-08-10");
    const ar = await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code: "1130" } });
    await db.account.create({ data: { ...ar, id: undefined, code: "1131", name: "Piutang Usaha Reseller" } });
    await inv("N-2", "Toko Sejahtera", "1000000", "2026-08-20", { arApCode: "1131" });
    await expect(settleFifo(db, { clientId: g.client.id, bankTransactionId: receipt.id, contactId: a.contactId })).rejects.toThrow(/memakai akun berbeda/);
    await expect(settleFifo(db, { clientId: g.client.id, bankTransactionId: receipt.id, contactId: "nope" })).rejects.toThrow(/Pilih pelanggan/);
    // Paid in advance: tag the line with the customer; a line matched to another customer's notes can't be retagged.
    expect((await tagAdvance(db, { clientId: g.client.id, bankTransactionId: receipt.id, contactId: a.contactId })).contactId).toBe(a.contactId);
    expect((await tagAdvance(db, { clientId: g.client.id, bankTransactionId: receipt.id, contactId: null })).contactId).toBeNull();
    const other = await inv("M-1", "PT Mitra Jasa", "1000000", "2026-08-31");
    await settleWithReclass(db, { clientId: g.client.id, invoiceId: other.id, bankTransactionId: (await tx("MITRA JASA")).id });
    await expect(tagAdvance(db, { clientId: g.client.id, bankTransactionId: (await tx("MITRA JASA")).id, contactId: a.contactId })).rejects.toThrow("Mutasi ini sudah dicocokkan ke M-1; tandanya mengikuti pencocokan itu.");
  });

  it("shows an overpayment as the customer's advance: the proof equals the GL, the aging has a credit row, the close lists it", async () => {
    const g = await makeGroup();
    const { tx, inv } = await setup(g);
    const a = await inv("N-1", "Toko Sejahtera", "2000000", "2026-08-10");
    await settleFifo(db, { clientId: g.client.id, bankTransactionId: (await tx("TOKO SEJAHTERA")).id, contactId: a.contactId }); // 9 jt for 2 jt
    await inv("M-1", "PT Mitra Jasa", "1000000", "2026-08-31");
    const asOf = dateOnly(2026, 8, 31);
    const [sub] = await subledgerVsLedger(db, g.client.id, "SALES", asOf, [g.pt.entity.id]);
    expect([sub.open, sub.advances, sub.unallocated, sub.subledger, sub.ledger, sub.equal]).toEqual([1_000_000n, 7_000_000n, 0n, -6_000_000n, -6_000_000n, true]);
    const view = await receivablesView(db, g.client.id, "SALES", asOf, [g.pt.entity]);
    expect(view.aging[0].rows.map((r) => [r.contact, r.total, r.advance, r.net, r.credit])).toEqual([
      ["PT Mitra Jasa", "1000000", "0", "1000000", false],
      ["Toko Sejahtera", "0", "7000000", "-7000000", true],
    ]);
    expect(view.aging[0].totals).toMatchObject({ total: "1000000", advance: "7000000", net: "-6000000" });
    const controls = await runControls(db, g.client.id, 2026, 8);
    expect(controls.find((c) => c.key === `ar:${g.pt.entity.id}`)).toMatchObject({ status: "PASS", detail: "Piutang terbuka Rp 1.000.000 − uang muka pelanggan Rp 7.000.000 = -Rp 6.000.000 (1130)" });
    expect(controls.find((c) => c.key === `overpaid:${g.pt.entity.id}`)).toMatchObject({ status: "REVIEW", title: "Kelebihan bayar pelanggan / pemasok" });
    expect(controls.find((c) => c.key === `overpaid:${g.pt.entity.id}`)?.detail).toContain("Toko Sejahtera Rp 7.000.000 (pelanggan)");
    // The client's own aging shows the same credit: per name it agrees with Buku, and the totals match the GL.
    const r = await importAging(db, { clientId: g.client.id, entityId: g.pt.entity.id, kind: "RECEIVABLE", asOf: "2026-08-31", fileName: "aging.csv", data: Buffer.from("Nama Pelanggan;Total\nPT Mitra Jasa;1.000.000\nToko Sejahtera;(7.000.000)\n") });
    expect(r.status).toBe("MATCH");
    expect((await compareSubledger(db, g.client.id, r.importId)).counterparties).toEqual([]);
  });

  it("keeps the proof equal with an untagged receipt on 1130 (Belum dialokasikan) and a split part on it", async () => {
    const g = await makeGroup();
    const { tx, inv } = await setup(g);
    await inv("M-1", "PT Mitra Jasa", "20000000", "2026-08-31");
    await reviewTransaction(db, { bankTxId: (await tx("MITRA JASA")).id, accountCode: "1130", taxTag: null });
    const [sub] = await subledgerVsLedger(db, g.client.id, "SALES", dateOnly(2026, 8, 31), [g.pt.entity.id]);
    expect([sub.open, sub.unallocated, sub.unsettledLines, sub.ledger, sub.equal]).toEqual([20_000_000n, 10_900_000n, 1, 9_100_000n, true]);
    const view = await receivablesView(db, g.client.id, "SALES", dateOnly(2026, 8, 31), [g.pt.entity]);
    expect([view.aging[0].unallocated, view.aging[0].unallocatedLines]).toEqual(["10900000", 1]);
    expect((await runControls(db, g.client.id, 2026, 8)).find((c) => c.key === `ar:${g.pt.entity.id}`)?.status).toBe("REVIEW");
    // Split: 900 rb of it was other income, 10 jt for the receivable. Only the 1130 part counts.
    await splitTransaction(db, { bankTxId: (await tx("MITRA JASA")).id, parts: [{ accountCode: "1130", amount: "10.000.000" }, { accountCode: "4100", amount: "900.000" }] });
    const [split] = await subledgerVsLedger(db, g.client.id, "SALES", dateOnly(2026, 8, 31), [g.pt.entity.id]);
    expect([split.unallocated, split.ledger, split.equal]).toEqual([10_000_000n, 10_000_000n, true]);
  });

  it("keeps an advance an advance at a month-end before the invoice it later pays, and works in a currency with cents", async () => {
    const g = await makeGroup();
    const { tx, inv } = await setup(g);
    const receipt = await tx("TOKO SEJAHTERA"); // 9 jt on 20 Aug
    const first = await inv("N-0", "Toko Sejahtera", "1000000", "2026-08-10");
    await settleFifo(db, { clientId: g.client.id, bankTransactionId: receipt.id, contactId: first.contactId }); // 1 jt, rest 8 jt
    const sep = await createInvoice(db, { clientId: g.client.id, entityId: g.pt.entity.id, direction: "SALES", contactName: "Toko Sejahtera", number: "N-1", issueDate: "2026-09-05", dueDate: "2026-09-30", dpp: "5000000", counterCode: "4100" });
    await settle(db, { clientId: g.client.id, invoiceId: sep.id, bankTransactionId: receipt.id });
    const at = async (d: Date) => (await subledgerVsLedger(db, g.client.id, "SALES", d, [g.pt.entity.id]))[0];
    // 31 Aug: N-1 doesn't exist yet, so the 5 jt it took is still the customer's advance (8 jt), as the GL says.
    expect(await at(dateOnly(2026, 8, 31))).toMatchObject({ open: 0n, advances: 8_000_000n, ledger: -8_000_000n, equal: true });
    expect(await at(dateOnly(2026, 9, 30))).toMatchObject({ open: 0n, advances: 3_000_000n, ledger: -3_000_000n, equal: true });

    // Another customer's document can't take this line (it is Toko Sejahtera's money), by FIFO or by hand.
    const other = await inv("M-1", "PT Mitra Jasa", "1000000", "2026-08-31");
    await expect(settleFifo(db, { clientId: g.client.id, bankTransactionId: receipt.id, contactId: other.contactId })).rejects.toThrow("Mutasi ini milik Toko Sejahtera");
    await expect(settle(db, { clientId: g.client.id, invoiceId: other.id, bankTransactionId: receipt.id })).rejects.toThrow("Mutasi ini milik Toko Sejahtera");
  });

  it("settles FIFO in minor units for an SGD entity", async () => {
    const g = await makeGroup();
    await db.entity.update({ where: { id: g.pt.entity.id }, data: { functionalCurrency: "SGD" } });
    await db.bankAccount.update({ where: { id: g.pt.banks[0].id }, data: { currency: "SGD" } });
    // Legacy foreign-currency row: parser imports are now IDR-only. Settlement still
    // supports existing minor-unit records without routing SGD through a Rupiah reader.
    const legacy = await db.statementImport.create({ data: {
      firmId: g.firm.id, bankAccountId: g.pt.banks[0].id, fileName: "legacy-sgd", format: "GENERIC",
      periodStart: dateOnly(2026, 8, 1), periodEnd: dateOnly(2026, 8, 31), openingBalance: 0n, closingBalance: 20_000n,
      rowCount: 1, continuityOk: true,
    } });
    const receipt = await db.bankTransaction.create({ data: { importId: legacy.id,
      firmId: g.firm.id, bankAccountId: g.pt.banks[0].id, entityId: g.pt.entity.id,
      date: dateOnly(2026, 8, 20), description: "TOKO SEJAHTERA", merchantKey: "TOKO SEJAHTERA",
      direction: "IN", amount: 20_000n, balance: 20_000n, rowNumber: 1, rawRow: "legacy SGD cents", hash: "legacy-sgd",
      status: "NEEDS_REVIEW", method: "HEURISTIC", confidence: 0, reason: "Legacy fixture", accountCode: "1999",
    } });
    const a = await createInvoice(db, { clientId: g.client.id, entityId: g.pt.entity.id, direction: "SALES", contactName: "Toko Sejahtera", number: "S-1", issueDate: "2026-08-01", dueDate: "2026-08-10", dpp: "100,50", counterCode: "4100" });
    const r = await settleFifo(db, { clientId: g.client.id, bankTransactionId: receipt.id, contactId: a.contactId });
    expect(r.settled).toEqual([{ number: "S-1", amount: 10_050n }]);
  });

  it("lists a refund on 1130 for tagging only, and a tag is locked-month checked and kept in the history", async () => {
    const g = await makeGroup();
    await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca.csv", data: Buffer.from(CSV), provider: null });
    const a = await createInvoice(db, { clientId: g.client.id, entityId: g.pt.entity.id, direction: "SALES", contactName: "CV Sumber Mesin", number: "N-1", issueDate: "2026-08-01", dpp: "1000000", counterCode: "4100" });
    // A refund to the customer: money out on the receivable.
    const refund = await db.bankTransaction.findFirstOrThrow({ where: { description: { contains: "SUMBER MESIN" } } });
    await reviewTransaction(db, { bankTxId: refund.id, accountCode: "1130", taxTag: null });
    const view = await receivablesView(db, g.client.id, "SALES", dateOnly(2026, 8, 31), [g.pt.entity]);
    expect(view.unsettled.map((l) => [l.description.slice(0, 30), l.free, l.refund])).toEqual([["TRSF E-BANKING DB CV SUMBER ME", "4000000", true]]);
    await tagAdvance(db, { clientId: g.client.id, bankTransactionId: refund.id, contactId: a.contactId });
    const [sub] = await subledgerVsLedger(db, g.client.id, "SALES", dateOnly(2026, 8, 31), [g.pt.entity.id]);
    expect([sub.open, sub.advances, sub.unallocated, sub.ledger, sub.equal]).toEqual([1_000_000n, -4_000_000n, 0n, 5_000_000n, true]);
    expect((await db.auditEvent.findFirstOrThrow({ where: { kind: "ADVANCE" } })).summary).toContain("ditandai milik CV Sumber Mesin");
    await db.period.upsert({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month: 8 } }, update: { status: "LOCKED" }, create: { firmId: g.firm.id, clientId: g.client.id, year: 2026, month: 8, status: "LOCKED" } });
    await expect(tagAdvance(db, { clientId: g.client.id, bankTransactionId: refund.id, contactId: null })).rejects.toThrow("Agustus 2026 sudah ditutup");
  });

  it("serialises a manual match and a FIFO on the same line without a deadlock", async () => {
    const g = await makeGroup();
    const { tx, inv } = await setup(g);
    const receipt = await tx("TOKO SEJAHTERA");
    await reviewTransaction(db, { bankTxId: receipt.id, accountCode: "1130", taxTag: null });
    for (let i = 0; i < 4; i++) {
      const a = await inv(`A-${i}`, "Toko Sejahtera", "100000", "2026-08-10");
      await inv(`B-${i}`, "Toko Sejahtera", "100000", "2026-08-11");
      const results = await Promise.allSettled([settle(db, { clientId: g.client.id, invoiceId: a.id, bankTransactionId: receipt.id }), settleFifo(db, { clientId: g.client.id, bankTransactionId: receipt.id, contactId: a.contactId })]);
      // Either may lose the race with a Bahasa refusal; neither dies on a database deadlock.
      for (const r of results) if (r.status === "rejected") expect(String(r.reason)).not.toMatch(/deadlock|40P01/i);
    }
  });
});
