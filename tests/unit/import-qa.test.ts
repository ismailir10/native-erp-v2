import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseStatement } from "@/lib/import/parsers";

// QA 2026-10-02: BUG-002 and BUG-004 (docs/qa/bugs).
const day = (d: Date) => d.toISOString().slice(0, 10);

describe("an .xlsx with ISO date cells (t=\"d\") is read with its real dates (BUG-002)", () => {
  const book = (cellDates: boolean) => {
    const wb = XLSX.utils.book_new();
    const rows = [["Tanggal", "Keterangan", "Debet", "Kredit", "Saldo"], [new Date(Date.UTC(2026, 9, 2)), "SETORAN", 0, 2_500_000, 102_500_000], [new Date(Date.UTC(2026, 9, 5)), "BAYAR SUPPLIER", 750_000, 0, 101_750_000]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates }), "Sheet1");
    return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellDates }));
  };

  it("SheetJS cellDates output (ISO text cells)", async () => {
    const st = await parseStatement("export.xlsx", book(true));
    expect(st.rows.map((r) => day(r.date))).toEqual(["2026-10-02", "2026-10-05"]);
    expect(st.periodStart.getUTCFullYear()).toBe(2026);
    expect(st.openingBalance).toBe(100_000_000n);
    expect(st.closingBalance).toBe(101_750_000n);
  });

  it("an ordinary Excel date (serial number with a date format) is unchanged", async () => {
    const st = await parseStatement("excel.xlsx", book(false));
    expect(st.rows.map((r) => r.amount)).toEqual([2_500_000n, -750_000n]);
  });
});

describe("a newest-first export is read from its oldest row (BUG-004)", () => {
  const csv = (rows: string[]) => Buffer.from(["Tanggal;Keterangan;Debet;Kredit;Saldo", ...rows, ""].join("\n"));

  it("opening, closing, period and order come out right, and the balance runs on", async () => {
    const st = await parseStatement("terbaru.csv", csv(["20/09/2026;TRSF C;0,00;3.000.000,00;103.500.000,00", "10/09/2026;TRSF B;500.000,00;0,00;100.500.000,00", "05/09/2026;TRSF A;0,00;1.000.000,00;101.000.000,00"]));
    expect(st.openingBalance).toBe(100_000_000n);
    expect(st.closingBalance).toBe(103_500_000n);
    expect(st.rows.map((r) => r.description)).toEqual(["TRSF A", "TRSF B", "TRSF C"]);
    expect(st.rows.map((r) => r.rowNumber)).toEqual([4, 3, 2]);
    expect(day(st.periodStart)).toBe("2026-09-01");
    expect(day(st.periodEnd)).toBe("2026-09-30");
    expect(st.notes?.join(" ")).toMatch(/dari yang terbaru/);
  });

  it("an oldest-first file is untouched", async () => {
    const st = await parseStatement("lama.csv", csv(["05/09/2026;TRSF A;0,00;1.000.000,00;101.000.000,00", "10/09/2026;TRSF B;500.000,00;0,00;100.500.000,00"]));
    expect(st.rows.map((r) => r.description)).toEqual(["TRSF A", "TRSF B"]);
    expect(st.openingBalance).toBe(100_000_000n);
    expect(st.notes?.join(" ") ?? "").not.toMatch(/terbaru/);
  });

  it("rows only slightly out of order are not reversed", async () => {
    const st = await parseStatement("acak.csv", csv(["05/09/2026;TRSF A;0,00;1.000.000,00;101.000.000,00", "04/09/2026;TRSF B;500.000,00;0,00;100.500.000,00", "10/09/2026;TRSF C;0,00;3.000.000,00;103.500.000,00"]));
    expect(st.rows.map((r) => r.description)).toEqual(["TRSF A", "TRSF B", "TRSF C"]);
  });
});
