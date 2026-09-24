import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { detectTables, readSheets, readTable } from "@/lib/ledger-import/read";

async function workbook(sheets: Record<string, unknown[][]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    for (const r of rows) ws.addRow(r);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const GL_HEADER = ["Entity", "GL Entry ID", "Entry Date", "Account Code", "Account Name", "Currency", "Debit", "Credit", "Reconstruction Logic / Description", "Notes"];

describe("ledger reader", () => {
  it("finds a multi-entity, multi-currency ledger sheet among others and keeps row refs", async () => {
    const buf = await workbook({
      README: [["Topic", "Definition"], ["GL", "single source of truth"]],
      GL_MASTER: [
        ["OPCO GL MASTER"],
        ["banner text"],
        GL_HEADER,
        ["SKP", "SKP-1", new Date(Date.UTC(2023, 0, 31)), "10000", "Petty Cash", "IDR", 1000.5, 0, "opening", ""],
        ["SKP", "SKP-2", new Date(Date.UTC(2023, 0, 31)), "31001", "Modal", "IDR", 0, 1000.5, "opening", ""],
        ["HOLDCO", "HC-1", "03/01/2023", "10001", "Bank OCBC USD", "USD", 150000, 0, "Loan", "Ref: JAN23-02; Rate: 1.31"],
        ["HOLDCO", "HC-2", "03/01/2023", "20000", "Loan Payable", "SGD", "", "150,000.00", "Loan", ""],
        ["CSP", "CSP-1", "31/03/2023", "11141", "Other Receivable", "IDR", { error: "#VALUE!" }, 0, "broken", ""],
        [],
      ],
    });
    const sheets = await readSheets("chickin.xlsx", buf);
    const cands = detectTables(sheets);
    expect(cands.map((c) => [c.sheet, c.mode])).toEqual([["GL_MASTER", "LEDGER"]]);
    const res = readTable(sheets, cands[0]);
    if (res.mode !== "LEDGER") throw new Error("mode");
    expect(res.rows).toHaveLength(5);
    expect(res.rows[0]).toMatchObject({ ref: "GL_MASTER!4", entity: "SKP", code: "10000", debit: 100050n, credit: 0n, currency: "IDR" });
    expect(res.rows[0].date?.toISOString().slice(0, 10)).toBe("2023-01-31");
    expect(res.rows[2]).toMatchObject({ currency: "USD", rate: "1.31", debit: 15_000_000n });
    expect(res.rows[3]).toMatchObject({ credit: 15_000_000n, debit: 0n });
    expect(res.rows[4].errors).toEqual(["debit bukan angka: #VALUE!"]);
  });

  it("moves negative amounts to the other side and flags missing dates", async () => {
    const buf = await workbook({ GL: [["Tanggal", "Kode Akun", "Nama Akun", "Debet", "Kredit"], ["", "1110", "Kas", -500, 0]] });
    const sheets = await readSheets("gl.xlsx", buf);
    const res = readTable(sheets, detectTables(sheets)[0]);
    if (res.mode !== "LEDGER") throw new Error("mode");
    expect(res.rows[0]).toMatchObject({ debit: 0n, credit: 50_000n, errors: ["tanggal kosong"] });
  });

  it("reads CSV ledgers", async () => {
    const csv = "No. Bukti;Tanggal;Kode Akun;Nama Akun;Debit;Kredit;Keterangan\nJV-1;31/01/2026;1110;Kas;1.500.000,00;0;Setor\nJV-1;31/01/2026;3100;Modal;0;1.500.000,00;Setor\n";
    const sheets = await readSheets("gl.csv", Buffer.from(csv));
    const res = readTable(sheets, detectTables(sheets)[0]);
    if (res.mode !== "LEDGER") throw new Error("mode");
    expect(res.rows.map((r) => [r.voucher, r.code, r.debit, r.credit])).toEqual([
      ["JV-1", "1110", 150_000_000n, 0n],
      ["JV-1", "3100", 0n, 150_000_000n],
    ]);
  });

  it("refuses .xls", async () => {
    await expect(readSheets("old.xls", Buffer.from("x"))).rejects.toThrow(/\.xls/);
  });
});

describe("Neraca reader (Jurnal-style export)", () => {
  it("reads codes, sections, uncoded equity rows and totals", async () => {
    const buf = await workbook({
      "31-05-2026": [
        ["PT CONTOH"],
        ["Balance Sheet"],
        ["(in IDR)"],
        ["Date", "", "31/05/2026", ""],
        ["Assets"],
        ["Current Assets"],
        ["1-1000", "BANK", 1000.6039, ""],
        ["1-1200", "Account Receivable", 500, ""],
        ["Total Current Assets", null, 1500.6039, ""],
        ["1-1801", "Accumulated Depreciation", -100, ""],
        ["Total Assets", null, 1400.6039, ""],
        ["Liability & Equity"],
        ["Current Liability"],
        ["2-2000", "Accounts Payable", 400, ""],
        ["Long-term Liability"],
        ["2-2744", "Others Payables-Related Parties", 300, ""],
        ["Equity"],
        ["3-3000", "Share Capital", 1000, ""],
        [null, "Current Period Earnings", -299.4, ""],
        [null, "Earnings up to Last Period", 0, ""],
        ["Total Liability & Equity", null, 1400.6039, ""],
      ],
    });
    const sheets = await readSheets("balance_sheet.xlsx", buf);
    const cands = detectTables(sheets);
    expect(cands).toHaveLength(1);
    const res = readTable(sheets, cands[0]);
    if (res.mode !== "NERACA") throw new Error("mode");
    expect(res.date?.toISOString().slice(0, 10)).toBe("2026-05-31");
    expect(res.rows.map((r) => [r.code, r.amount, r.typeHint])).toEqual([
      ["1-1000", 100_060n, "ASET"],
      ["1-1200", 50_000n, "ASET"],
      ["1-1801", -10_000n, "ASET"],
      ["2-2000", -40_000n, "LIABILITAS"],
      ["2-2744", -30_000n, "LIABILITAS"],
      ["3-3000", -100_000n, "EKUITAS"],
      ["NC:Current Period Earnings", 29_940n, "EKUITAS"],
    ]);
    expect(res.totals.filter((t) => t.kind !== "OTHER").map((t) => [t.kind, t.amount])).toEqual([
      ["ASSETS", 140_060n],
      ["LIAB_EQUITY", 140_060n],
    ]);
  });
});
