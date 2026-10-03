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
});
