import { describe, expect, it } from "vitest";
import { layoutSignature, readGrid, sameRow } from "@/lib/import/grid";
import { parseStatementSections } from "@/lib/import/parsers";
import { makePdf } from "../pdf-fixture";
import { unknownCsv, unknownPdf, unknownXlsx } from "../unknown-layout";

describe("a statement file as a grid (Atur kolom)", () => {
  it("is a layout the readers refuse, in all three kinds", async () => {
    for (const [name, data] of [["x.csv", unknownCsv()], ["x.pdf", unknownPdf()], ["x.xlsx", await unknownXlsx()]] as const) {
      await expect(parseStatementSections(name, data)).rejects.toThrow();
    }
  });

  it("reads a CSV as written, row numbers as the file numbers them", async () => {
    const g = await readGrid(unknownCsv());
    expect(g.kind).toBe("CSV");
    const rows = g.sheets[0].rows;
    expect(rows[0]).toEqual(["POSISI KAS HARIAN"]);
    expect(rows[2]).toEqual([]);
    expect(rows[3]).toEqual(["Value Dt", "Ref", "Particulars", "Withdrawn", "Lodged", "Position"]);
    expect(rows[5]).toEqual(["01/08/2026", "R1", "TRSF E-BANKING CR 0108/FTSCY/WS95031", "", "55.500.000,00", "155.500.000,00"]);
    expect(rows[6]).toEqual(["", "", "PT MITRA UNGGAS FIKTIF"]);
  });

  it("reads a workbook sheet by sheet, Excel dates as ISO text", async () => {
    const g = await readGrid(await unknownXlsx());
    expect(g.kind).toBe("XLSX");
    expect(g.sheets.map((s) => s.name)).toEqual(["Kas"]);
    expect(g.sheets[0].rows[2]).toEqual(["Value Dt", "Particulars", "Amt", "D/C", "Position"]);
    expect(g.sheets[0].rows[3]).toEqual(["2026-08-31", "BIAYA ADM", "15000", "D", "138080678"]);
  });

  it("cuts a text PDF's lines into the columns of its header, Debet and Kredit apart", async () => {
    const g = await readGrid(unknownPdf());
    expect(g.kind).toBe("PDF");
    expect(g.pages).toBe(1);
    const rows = g.sheets[0].rows;
    const header = rows.findIndex((r) => r[0] === "Value Dt");
    expect(rows[header]).toEqual(["Value Dt", "Particulars", "Withdrawn", "Lodged", "Position"]);
    expect(rows[header + 1]).toEqual(["01/08/2026", "TRSF E-BANKING CR 0108/FTSCY/WS95031", "", "55,500,000.00", "155,500,000.00"]);
    expect(rows[header + 2]).toEqual(["", "PT MITRA UNGGAS FIKTIF"]);
    expect(rows[header + 3]).toEqual(["02/08/2026", "PEMBAYARAN LISTRIK PLN", "2,450,000.00", "", "153,050,000.00"]);
    // Page furniture stays in, as printed.
    expect(rows[0]).toEqual(["POSISI KAS HARIAN"]);
    expect(rows[rows.length - 1]).toEqual(["Halaman 1 dari 1"]);
  });

  it("refuses a PDF with no text to read", async () => {
    await expect(readGrid(makePdf([[]]))).rejects.toThrow(/tidak berisi teks/);
  });

  it("fingerprints a layout by its header words, not by its rows or punctuation", () => {
    const a = layoutSignature("CSV", ["Value Dt", "Ref", "Particulars", "Withdrawn", "Lodged", "Position"]);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(layoutSignature("CSV", [" value dt ", "REF", "Particulars:", "Withdrawn", "Lodged", "Position"])).toBe(a);
    expect(layoutSignature("PDF", ["Value Dt", "Ref", "Particulars", "Withdrawn", "Lodged", "Position"])).not.toBe(a);
    expect(layoutSignature("CSV", ["Value Dt", "Ref", "Narrative", "Withdrawn", "Lodged", "Position"])).not.toBe(a);
    // A data row is no fingerprint.
    expect(layoutSignature("CSV", ["01/08/2026", "R1", "55.500.000,00", "155.500.000,00"])).toBeNull();
  });

  it("tells a repeated header from a transaction row", () => {
    expect(sameRow(["Value Dt", "Particulars"], ["value dt", "PARTICULARS", ""])).toBe(true);
    expect(sameRow(["Value Dt", "Particulars"], ["01/08/2026", "Particulars"])).toBe(false);
    expect(sameRow([], [])).toBe(false);
  });
});
