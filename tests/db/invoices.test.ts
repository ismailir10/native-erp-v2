import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { createInvoice, ppnFor } from "@/lib/receivables/invoices";
import { postOpening } from "@/lib/opening";
import { dateOnly } from "@/lib/format";

type G = Awaited<ReturnType<typeof makeGroup>>;
const lines = async (entryId: string) =>
  (await db.journalLine.findMany({ where: { entryId }, include: { account: true }, orderBy: { id: "asc" } })).map((l) => [l.account.code, l.debit, l.credit]);
const sale = (g: G, over: Partial<Parameters<typeof createInvoice>[1]> = {}) =>
  createInvoice(db, { clientId: g.client.id, entityId: g.pt.entity.id, direction: "SALES", contactName: "PT Mitra Unggas", number: "INV-001", issueDate: "2026-08-05", dueDate: "2026-09-04", dpp: "10.000.000", ppn: "1.100.000", counterCode: "4100", ...over });

describe("invoices", () => {
  beforeEach(resetDb);

  it("posts a sales invoice: Dr receivable total, Cr revenue DPP, Cr PPN Keluaran", async () => {
    const g = await makeGroup();
    const inv = await sale(g);
    expect(inv).toMatchObject({ dpp: 10_000_000n, ppn: 1_100_000n, total: 11_100_000n, opening: false });
    expect(await lines(inv.entryId!)).toEqual([["1130", 11_100_000n, 0n], ["4100", 0n, 10_000_000n], ["2130", 0n, 1_100_000n]]);
    const entry = await db.journalEntry.findUniqueOrThrow({ where: { id: inv.entryId! } });
    expect(entry).toMatchObject({ kind: "INVOICE", memo: "Faktur INV-001 · PT Mitra Unggas" });
    expect(entry.date.toISOString().slice(0, 10)).toBe("2026-08-05");
    // The contact is reused by name.
    await sale(g, { number: "INV-002", contactName: "PT  Mitra Unggas " });
    expect(await db.contact.count({ where: { clientId: g.client.id } })).toBe(1);
  });

  it("posts a purchase bill to an asset account with PPN Masukan", async () => {
    const g = await makeGroup();
    const bill = await createInvoice(db, { clientId: g.client.id, entityId: g.pt.entity.id, direction: "PURCHASE", contactName: "CV Sumber Mesin", number: "SM/08/77", issueDate: "2026-08-10", dpp: "20000000", ppn: String(ppnFor(20_000_000n)), counterCode: "1210" });
    expect(bill.dueDate.toISOString().slice(0, 10)).toBe("2026-08-10");
    expect(await lines(bill.entryId!)).toEqual([["1210", 20_000_000n, 0n], ["1150", 2_200_000n, 0n], ["2110", 0n, 22_200_000n]]);
    expect(await db.journalEntry.findUniqueOrThrow({ where: { id: bill.entryId! } })).toMatchObject({ memo: "Tagihan SM/08/77 · CV Sumber Mesin" });
  });

  it("records a Saldo Awal invoice without a journal, dated by the opening", async () => {
    const g = await makeGroup();
    await expect(sale(g, { opening: true, issueDate: "2026-06-20" })).rejects.toThrow(/Catat Saldo Awal/);
    await postOpening(db, { clientId: g.client.id, entityId: g.pt.entity.id, date: dateOnly(2026, 6, 30), lines: [{ accountCode: "1130", debit: "11100000", credit: "0" }] });
    await expect(sale(g, { opening: true, issueDate: "2026-07-02" })).rejects.toThrow(/paling lambat 30 Jun 2026/);
    const inv = await sale(g, { opening: true, issueDate: "2026-06-20" });
    expect(inv).toMatchObject({ opening: true, entryId: null });
    expect(await db.journalEntry.count({ where: { kind: "INVOICE" } })).toBe(0);
  });

  it("refuses what a subledger can't hold", async () => {
    const g = await makeGroup();
    await sale(g);
    await expect(sale(g)).rejects.toThrow(/INV-001 sudah dipakai/);
    await expect(sale(g, { number: "X1", dueDate: "2026-08-01" })).rejects.toThrow(/Jatuh tempo/);
    await expect(sale(g, { number: "X2", counterCode: "6190" })).rejects.toThrow(/akun pendapatan/);
    await expect(sale(g, { number: "X3", arApCode: "2110" })).rejects.toThrow(/Piutang Usaha/);
    await expect(sale(g, { number: "X4", dpp: "0", ppn: "0" })).rejects.toThrow(/lebih dari nol/);
    await expect(sale(g, { number: "X5", issueDate: "2026-02-30" })).rejects.toThrow(/Tanggal faktur/);
    await expect(createInvoice(db, { clientId: g.client.id, entityId: g.pt.entity.id, direction: "PURCHASE", contactName: "Bank", number: "B1", issueDate: "2026-08-10", dpp: "1", counterCode: "1101" })).rejects.toThrow(/bukan akun bank/);
    await db.period.create({ data: { firmId: g.firm.id, clientId: g.client.id, year: 2026, month: 9, status: "LOCKED" } });
    await expect(sale(g, { number: "X6", issueDate: "2026-09-10", dueDate: "2026-09-30" })).rejects.toThrow(/ditutup|dikunci/i);
    expect(await db.invoice.count()).toBe(1);
  });

  it("prefills PPN at the effective 11 % rounded half up", () => {
    expect(ppnFor(10_000_000n)).toBe(1_100_000n);
    expect(ppnFor(15n)).toBe(2n); // 1,65 → 2
    expect(ppnFor(4n)).toBe(0n); // 0,44 → 0
  });
});
