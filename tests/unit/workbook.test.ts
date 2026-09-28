import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { asXlsx, sniffFile } from "@/lib/import/workbook";
import { htmlXls, workbook } from "@/tests/xls-fixture";

async function rows(xlsx: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
  return wb.worksheets.map((ws) => ({ name: ws.name, rows: ws.getSheetValues().slice(1).map((r) => (r as ExcelJS.CellValue[] | undefined)?.slice(1) ?? []) }));
}

describe("spreadsheet sniffing", () => {
  it("recognises files by their bytes, not their names", () => {
    expect(sniffFile(Buffer.from("%PDF-1.7\n"))).toBe("PDF");
    expect(sniffFile(workbook([{ name: "S", rows: [["a"]] }], "xlsx"))).toBe("XLSX");
    expect(sniffFile(workbook([{ name: "S", rows: [["a"]] }], "biff8"))).toBe("XLS");
    expect(sniffFile(htmlXls([["Tanggal"]]))).toBe("MARKUP");
    expect(sniffFile(Buffer.from('﻿<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"/>'))).toBe("MARKUP");
    expect(sniffFile(Buffer.from("Tanggal\tKeterangan\n"))).toBe("TEXT");
  });

  it("leaves PDF and text alone and passes .xlsx through", () => {
    expect(asXlsx(Buffer.from("Tanggal;Keterangan\n"))).toBeNull();
    const x = workbook([{ name: "S", rows: [["a"]] }], "xlsx");
    expect(asXlsx(x)).toBe(x);
  });
});

describe("legacy Excel → .xlsx", () => {
  it("keeps sheets, dates (exact, UTC), numbers and text of a BIFF8 .xls", async () => {
    const xls = workbook(
      [
        { name: "MEI 2026", rows: [["Tanggal", "Keterangan", "Debet", "Kredit", "Saldo"], [{ date: "2026-05-02" }, "TRSF", 1_500_000.5, null, 98_500_000]] },
        { name: "JUN 2026", rows: [["Tanggal"], ["01/06"]] },
      ],
      "biff8",
    );
    const out = await rows(asXlsx(xls)!);
    expect(out.map((s) => s.name)).toEqual(["MEI 2026", "JUN 2026"]);
    const [date, desc, debit, credit, balance] = out[0].rows[1];
    expect(date).toBeInstanceOf(Date);
    expect((date as Date).toISOString()).toBe("2026-05-02T00:00:00.000Z");
    expect([desc, debit, credit, balance]).toEqual(["TRSF", 1_500_000.5, undefined, 98_500_000]);
    expect(out[1].rows[1][0]).toBe("01/06");
  });

  it("keeps every HTML cell as text, so Indonesian number formats are never misread", async () => {
    const out = await rows(asXlsx(htmlXls([["Tanggal", "Mutasi"], ["03/08/2026", "1.234.567,00"], ["0012", "1.234"]]))!);
    expect(out[0].rows.slice(1)).toEqual([["03/08/2026", "1.234.567,00"], ["0012", "1.234"]]);
  });

  it("refuses bytes that only look like an old Excel file", () => {
    const broken = Buffer.concat([Buffer.from("d0cf11e0a1b11ae1", "hex"), Buffer.alloc(600, 1)]);
    expect(() => asXlsx(broken)).toThrow(/tidak bisa dibuka|kata sandi/);
  });
});
