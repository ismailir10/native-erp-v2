import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseStatementSections } from "@/lib/import/parsers";
import { checkContinuity } from "@/lib/import/normalize";
import { dateOnly } from "@/lib/format";

/** UC-B1 cases in CSV / XLSX statements: each lost or misplaced rows silently before this cycle (review probes a3, b3, b4, e1-e3, x1). */
async function xlsx(sheets: { name: string; rows: (string | number | null)[][] }[]) {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    s.rows.forEach((r) => ws.addRow(r));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const H = ["Tanggal", "Keterangan", "Debet", "Kredit", "Saldo"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const one = async (name: string, data: Buffer, opts: { year?: number } = {}) => (await parseStatementSections(name, data, opts))[0];

describe("statement reader, UC-B1", () => {
  it("(a3) a transaction row with no date takes the row above's date and is said; one without a balance is named, not lost", async () => {
    const csv = ["Tanggal,Keterangan,Debet,Kredit,Saldo", "01/08/2026,SETORAN A,0,1000,11000", ",BAYAR B,500,0,10500", "03/08/2026,SETORAN C,0,2000,12500"].join("\n");
    const st = await one("x.csv", Buffer.from(csv));
    expect(st.rows.map((r) => [iso(r.date), r.amount])).toEqual([["2026-08-01", 1000n], ["2026-08-01", -500n], ["2026-08-03", 2000n]]);
    expect(st.notes).toContain("1 baris tanpa tanggal memakai tanggal baris di atasnya (baris 3); saldo berjalannya ikut diperiksa.");
    expect(checkContinuity(st).ok).toBe(true);
    const noBalance = ["Tanggal,Keterangan,Debet,Kredit,Saldo", "01/08/2026,SETORAN A,0,1000,11000", ",BAYAR B,500,0,", "03/08/2026,SETORAN C,0,2000,12500"].join("\n");
    expect((await one("x.csv", Buffer.from(noBalance))).notes?.some((n) => n.startsWith("1 baris bernominal tanpa tanggal dan tanpa saldo dilewati (baris 3)"))).toBe(true);
  });

  it("(b4/b3) a dated SALDO AWAL row that writes its amount in Kredit is the opening, not a transaction", async () => {
    const b4 = await one("x.xlsx", await xlsx([{ name: "S", rows: [H, ["01/08/2026", "Saldo Awal", null, 10000, 10000], ["01/08/2026", "A", 0, 1000, 11000], ["02/08/2026", "B", 500, 0, 10500]] }]));
    expect([b4.openingBalance, b4.rows.length]).toEqual([10000n, 2]);
    expect(b4.notes?.some((n) => /baris saldo awal menulis nominal 10\.000 di kolom mutasi/.test(n))).toBe(true);
    const b3 = await one("x.xlsx", await xlsx([{ name: "S", rows: [H, ["01/08/2026", "Saldo Awal", null, 10000, null], ["01/08/2026", "A", 0, 1000, 11000], ["02/08/2026", "B", 500, 0, 10500]] }]));
    expect([b3.openingBalance, b3.rows.length, checkContinuity(b3).ok]).toEqual([10000n, 2, true]);
  });

  it("(x1) a dated row with no amount whose balance moved becomes a transaction of that move, noted", async () => {
    const st = await one("x.xlsx", await xlsx([{ name: "S", rows: [H, [null, "SALDO AWAL", null, null, 10000], ["01/08/2026", "A", 0, 1000, 11000], ["02/08/2026", "BIAYA ADMIN", null, null, 10985], ["03/08/2026", "C", 0, 15, 11000]] }]));
    expect(st.rows.map((r) => r.amount)).toEqual([1000n, -15n, 15n]);
    expect(st.notes?.some((n) => /nominal kosong tetapi saldo turun Rp 15; dicatat keluar Rp 15/.test(n))).toBe(true);
    expect(checkContinuity(st).ok).toBe(true);
  });

  it("(e3) a December row on a January sheet of a year-less file belongs to the year before", async () => {
    const st = await one("x.xlsx", await xlsx([
      { name: "DES", rows: [H, ["SALDO AWAL", null, null, null, 10000], ["05/12", "A", 0, 1000, 11000], ["20/12", "B", 500, 0, 10500]] },
      { name: "JAN", rows: [H, ["31/12", "C", 0, 100, 10600], ["02/01", "D", 0, 200, 10800]] },
    ]), { year: 2025 });
    expect(st.rows.map((r) => iso(r.date))).toEqual(["2025-12-05", "2025-12-20", "2025-12-31", "2026-01-02"]);
    expect([iso(st.periodStart), iso(st.periodEnd)]).toEqual(["2025-12-01", "2026-01-31"]);
    expect(st.notes?.some((n) => n.startsWith("1 baris di lembar JAN bertanggal di luar bulan lembarnya (12/2025)"))).toBe(true);
  });

  it("(f) a year typo is read in the statement's year; the period follows", async () => {
    const rows: (string | number | null)[][] = [H, [null, "SALDO AWAL", null, null, 10000], ["02/08/2023", "A", 0, 100, 10100]];
    let bal = 10100;
    for (const d of ["03", "05", "08", "12", "20"]) rows.push([`${d}/08/2026`, "X", 0, 100, (bal += 100)]);
    const st = await one("x.xlsx", await xlsx([{ name: "S", rows }]));
    expect(iso(st.rows[0].date)).toBe("2026-08-02");
    expect(iso(st.periodStart)).toBe("2026-08-01");
    expect(st.notes?.some((n) => /tanggal 2 Agu 2023 dibaca 2 Agu 2026/.test(n))).toBe(true);
  });

  it("leaves a sparse January-to-July year-less file in one year", async () => {
    const st = await one("x.xlsx", await xlsx([{ name: "S", rows: [H, ["SALDO AWAL", null, null, null, 10000], ["05/01", "A", 0, 1000, 11000], ["20/07", "B", 500, 0, 10500]] }]), { year: 2026 });
    expect(st.rows.map((r) => iso(r.date))).toEqual(["2026-01-05", "2026-07-20"]);
    expect(dateOnly(2026, 1, 1)).toEqual(st.periodStart);
  });
});
