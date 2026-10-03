import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { readAging } from "@/lib/reconcile/aging-read";

/** An AMS-style aging export: title rows, headers on rows 6–7 under a merged "Umur" title, "1-30" turned into a date by Excel. */
async function amsFile() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Aging AR");
  ws.getCell("A1").value = "PT AMS";
  ws.getCell("A2").value = "Laporan Umur Piutang per 31 Desember 2023";
  ws.getRow(6).values = ["No", "Nama Pelanggan", "Umur Piutang (hari)", null, null, null, null, null, "Total"];
  ws.mergeCells("C6:H6");
  ws.getRow(7).values = [null, null, "Not Yet Due", new Date(Date.UTC(2023, 0, 30)), "31-60", "61-90", "91-120", "> 120", null];
  ws.getRow(8).values = [1, "PT Sinar Jaya", "1.000.000,50", "500.000", null, null, null, null, "1.500.000,50"];
  ws.getRow(9).values = [2, "CV Maju", 2_000_000, null, 1_000_000, null, null, 250_000, 3_250_000];
  ws.getRow(10).values = [3, "Toko Lancar (uang muka)", "(500.000,00)", null, null, null, null, null, "(500.000,00)"];
  ws.getRow(11).values = [null, "Grand Total", null, null, null, null, null, null, 4_250_000.5];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("aging reader (UC-A1)", () => {
  it("finds the header block under title rows, maps the buckets (the 1-30 date included), keeps credits and sheet!row, skips totals", async () => {
    const a = await readAging(await amsFile());
    expect([a.sheet, a.headerRow]).toEqual(["Aging AR", 7]);
    expect(a.buckets).toEqual(["NOT_DUE", "D1_30", "D31_60", "D61_90", "D91_120", "OVER_120"]);
    expect(a.rows.map((r) => [r.counterparty, r.total, r.sourceRef, r.rounded])).toEqual([
      ["PT Sinar Jaya", 1_500_001n, "Aging AR!8", true],
      ["CV Maju", 3_250_000n, "Aging AR!9", false],
      ["Toko Lancar (uang muka)", -500_000n, "Aging AR!10", false],
    ]);
    expect(a.rows[0].buckets).toMatchObject({ NOT_DUE: 1_000_001n, D1_30: 500_000n });
    expect(a.rows[1].buckets).toMatchObject({ NOT_DUE: 2_000_000n, D31_60: 1_000_000n, OVER_120: 250_000n });
    expect(a.notes).toEqual(["1 baris memakai sen dan dibulatkan ke Rupiah penuh."]);
  });

  it("reads a semicolon CSV with Indonesian amounts and a 1-30 typed as an Excel serial", async () => {
    const csv = ["Aging Hutang;;;;", "Supplier;Belum Jatuh Tempo;45687;> 90;Saldo", "PT Baja;1.000.000;2.000.000;0;3.000.000", "Jumlah;;;;3.000.000", ""].join("\n");
    const a = await readAging(Buffer.from(csv));
    expect(a.buckets).toEqual(["NOT_DUE", "D1_30", "OVER_90"]);
    expect(a.rows.map((r) => [r.counterparty, r.total, r.buckets.D1_30])).toEqual([["PT Baja", 3_000_000n, 2_000_000n]]);
  });

  it("refuses a file without a counterparty or a total column, saying which", async () => {
    await expect(readAging(Buffer.from("Tanggal;Keterangan;Total\n01/01/2026;x;100\n"))).rejects.toThrow("tidak ada kolom nama pelanggan/pemasok");
    await expect(readAging(Buffer.from("Nama Pelanggan;Umur\nPT A;100\n"))).rejects.toThrow("tidak ada kolom total/saldo");
  });

  it("takes the Saldo column as total even under a merged 'Total Umur Piutang' title, and the Nama column over No and Kode", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("AR");
    ws.getCell("A1").value = "Daftar Umur Piutang Pelanggan";
    ws.getRow(3).values = ["No", "Kode Pelanggan", "Nama Pelanggan", "Saldo", "Total Umur Piutang"];
    ws.mergeCells("E3:H3");
    ws.getRow(4).values = [null, null, null, null, "1-30", "31-60", "61-90", "> 60"];
    ws.getRow(5).values = [1, "C001", "PT Sinar Jaya", 100, 60, 40, null, null];
    ws.getRow(6).values = [2, "C002", "CV Maju", 50, null, null, null, 50];
    const a = await readAging(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(a.rows.map((r) => [r.counterparty, r.total])).toEqual([["PT Sinar Jaya", 100n], ["CV Maju", 50n]]);
    expect(a.notes).toEqual([]);
  });

  it("prefers the sheet with age columns over a summary sheet, and uses the buckets for a formula total without a result", async () => {
    const wb = new ExcelJS.Workbook();
    const sum = wb.addWorksheet("Ringkasan");
    sum.getRow(1).values = ["Nama Akun", "Total"];
    sum.getRow(2).values = ["Piutang Usaha", 300];
    const ws = wb.addWorksheet("Aging");
    ws.getRow(1).values = ["Nama Pelanggan", "Belum jatuh tempo", "1-30", "Total"];
    ws.getRow(2).values = ["PT Sinar Jaya", 100, 50, { formula: "B2+C2" } as unknown as ExcelJS.CellValue];
    ws.getRow(3).values = ["CV Maju", 150, null, 150];
    const a = await readAging(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(a.sheet).toBe("Aging");
    expect(a.rows.map((r) => [r.counterparty, r.total])).toEqual([["PT Sinar Jaya", 150n], ["CV Maju", 150n]]);
    expect(a.notes).toEqual(["Dibaca dari lembar Aging (yang punya kolom umur dan baris terbanyak).", "1 baris tanpa nilai total (rumus tanpa hasil); dipakai jumlah kolom umurnya."]);
  });

  it("stops at the grand total (a footer is no counterparty) and reads trailing-minus and CR credits", async () => {
    const csv = [
      "Nama Pelanggan;1-30;Total",
      "PT A;1.000;1.000",
      "PT B;1.000-;1.000-",
      "PT C;;500 CR",
      "PT D;200;300",
      "Grand Total;;500-",
      "Saldo menurut GL;;120",
      "Selisih;;20",
      "",
    ].join("\n");
    const a = await readAging(Buffer.from(csv));
    expect(a.rows.map((r) => [r.counterparty, r.total])).toEqual([["PT A", 1_000n], ["PT B", -1_000n], ["PT C", -500n], ["PT D", 300n]]);
    expect(a.notes).toEqual(["1 baris: total tidak sama dengan jumlah kolom umur (mis. CSV!5). Total yang dipakai.", "2 baris di bawah Grand Total dilewati (bukan pelanggan/pemasok)."]);
  });
});
