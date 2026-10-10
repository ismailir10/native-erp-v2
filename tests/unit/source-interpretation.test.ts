import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseBca } from "@/lib/import/parsers/bca";
import { parseBankAmount, closingFromRows, sourceCurrency } from "@/lib/import/parsers/common";
import { parseTabular, parseWorkbook, xlsxToSheets } from "@/lib/import/parsers/tabular";
import { parsePdf, parsePdfSections } from "@/lib/import/parsers/pdf";
import { makePdf, smbcCombinedPdf, table } from "../pdf-fixture";
import { readMappedDetail, readWithLayout, signatureOf, type ColumnMapping } from "@/lib/import/mapped";
import { readGrid, type Grid } from "@/lib/import/grid";
import { parseStatement } from "@/lib/import/parsers";
import { AmbiguousDateError, SourceCurrencyError, SourceDateError } from "@/lib/import/types";
import type { ParsedRow } from "@/lib/import/types";

const rows = (unit = "IDR") => [
  ["Currency", unit],
  ["Date", "Description", "Amount", "Balance"],
  ["2026-08-13", "Customer USD services", "10.50", "110.50"],
];
const pdf = (declaration: string, amountHeader = "Amount") => makePdf([[
  ...table(800, [[[40, "Bank statement"]], [[40, declaration]], [[40, "Period: 01/08/2026 - 31/08/2026"]]]),
  ...table(730, [
    [[40, "Date"], [150, "Description"], [400, amountHeader], [510, "Balance"]],
    [[40, "13/08/2026"], [150, "Receipt"], [400, "10.50"], [510, "110.50"]],
  ]),
]]);

describe("source currency before Rupiah conversion", () => {
  it.each(["USD", "SGD", "EUR"])("refuses %s in a single-account table", (unit) => {
    expect(() => parseTabular(rows(unit), "GENERIC")).toThrow(/Mata uang.*belum didukung/);
  });
  it("checks amount header units and contradictory declarations", () => {
    expect(() => parseTabular([["Date", "Description", "Amount (USD)", "Balance"], ["2026-08-13", "Receipt", "10.50", "110.50"]], "GENERIC")).toThrow(/USD/);
    expect(() => parseTabular([["Currency: IDR"], ["Date", "Description", "Amount (SGD)", "Balance"], ["2026-08-13", "Receipt", "10.50", "110.50"]], "GENERIC")).toThrow(/bertentangan/);
  });
  it("rejects a foreign symbol in amount cells even without a currency declaration", () => {
    const data = rows().slice(1); data[1][2] = "$10.50";
    expect(() => parseTabular(data, "GENERIC")).toThrow(/Mata uang/);
  });
  it("reads currency attached to an account title without treating company names as units", () => {
    expect(() => sourceCurrency(["Savings Account (SGD) 123456789"], [])).toThrow(/SGD/);
    expect(() => sourceCurrency(["Account USD 1111111111"], [])).toThrow(/USD/);
    expect(() => sourceCurrency(["No. rekening SGD 1111111111"], [])).toThrow(/SGD/);
    expect(sourceCurrency(["PT USD (Indonesia)", "Account holder: PT USD Services"], [])).toBeUndefined();
  });
  it("retains IDR and ignores incidental currency codes in names/descriptions", () => {
    const statement = parseTabular([["PT USD Services"], ...rows()], "GENERIC");
    expect(statement.currency).toBe("IDR");
    expect(statement.rows[0].amount).toBe(11n); // explicitly IDR sen policy
    expect(sourceCurrency(["PT SGD Indonesia", "Bank USD Corporate"], ["Description"])).toBeUndefined();
  });
  it.each(["USD", "SGD"])("refuses %s in a real XLSX single-account workbook", async (unit) => {
    const workbook = new ExcelJS.Workbook(); workbook.addWorksheet("Statement").addRows(rows(unit));
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const sheets = await xlsxToSheets(bytes);
    expect(() => parseWorkbook(sheets)).toThrow(new RegExp(unit));
  });
  it.each(["USD", "SGD"])("refuses %s in a single-account PDF", async (unit) => {
    await expect(parsePdf(pdf(`Mata Uang: ${unit}`))).rejects.toThrow(new RegExp(unit));
  });
  it("checks PDF money column units and conflicting declarations", async () => {
    await expect(parsePdf(pdf("Account: 123456789", "Amount (USD)"))).rejects.toThrow(/USD/);
    await expect(parsePdf(pdf("Currency: IDR", "Amount (SGD)"))).rejects.toThrow(/bertentangan/);
  });
  it("keeps IDR sections selectable while foreign sections carry an explicit error and no parsed money", async () => {
    const sections = await parsePdfSections(smbcCombinedPdf());
    expect(sections[0]).toMatchObject({ currency: "IDR", openingBalance: 5646633n });
    expect(sections[0].error).toBeUndefined();
    expect(sections[2]).toMatchObject({ currency: "JPY", rows: [], openingBalance: 0n, closingBalance: 0n });
    expect(sections[2].error).toMatch(/JPY.*belum didukung/);
  });
});

const bca = (date: string, year = 2026) => `Informasi Rekening\nPeriode : 01/02/${year} - 28/02/${year}\nTanggal Transaksi,Keterangan,Cabang,Jumlah,,Saldo\n${date},Receipt,000,100,CR,1100\nSaldo Awal : 1000`;
describe("calendar and source provenance", () => {
  it.each(["31/02", "29/02", "00/02", "01/13"])("refuses BCA impossible yearless date %s", (date) => {
    expect(() => parseBca(bca(date))).toThrow(/kalender/);
  });
  it("accepts a leap day only in a leap year", () => {
    expect(parseBca(bca("29/02", 2024)).rows[0].date.toISOString()).toBe("2024-02-29T00:00:00.000Z");
  });
  it("does not confuse a row-derived closing with the printed closing", () => {
    const inferred = parseTabular(rows(), "GENERIC");
    expect(inferred.provenance).toEqual({ period: "INFERRED", opening: "DERIVED", closing: "ROW" });
    expect(parseBca(bca("13/02")).provenance).toEqual({ period: "DECLARED", opening: "PRINTED", closing: "ROW" });
    expect(parseBca(`${bca("13/02")}\nSaldo Akhir : 1100`).provenance?.closing).toBe("PRINTED");
  });
  it("includes movements after the final printed balance", () => {
    const statement = parseTabular([
      ["Date", "Description", "Amount", "Balance"],
      ["2026-08-13", "Receipt", "100", "1100"],
      ["2026-08-14", "Receipt", "200", ""],
    ], "GENERIC");
    expect(statement.closingBalance).toBe(1300n);
    expect(statement.provenance?.closing).toBe("DERIVED");
    expect(closingFromRows([{ amount: 100n, balance: null }, { amount: -50n, balance: null }] as ParsedRow[], 1000n)).toBe(1050n);
  });
});


describe("currency columns and mapped-reader enforcement", () => {
  const mapping: ColumnMapping = { sheet: null, firstRow: 2, date: 0, description: [1], amount: { style: "signed", column: 3, direction: null }, balance: 4, order: "DMY" };
  const grid = (header: string, currency = "USD"): Grid => ({ kind: "CSV", pages: 0, sheets: [{ name: "", rows: [
    ["Date", "Description", header, "Amount", "Balance"],
    ["2026-08-13", "Receipt", currency, "10.50", "110.50"],
  ] }] });
  it.each(["Currency", "CCY", "Mata Uang", "Currency / Mata Uang"])("refuses %s columns in generic and mapped readers", (header) => {
    const source = grid(header);
    expect(() => parseTabular(source.sheets[0].rows, "GENERIC")).toThrow(SourceCurrencyError);
    expect(() => readMappedDetail(source, mapping)).toThrow(SourceCurrencyError);
  });
  it("detects currency conflicts across rows and preserves explicit IDR", () => {
    const source = grid("Currency", "IDR");
    expect(parseTabular(source.sheets[0].rows, "GENERIC").currency).toBe("IDR");
    expect(readMappedDetail(source, mapping).statement.currency).toBe("IDR");
    source.sheets[0].rows.push(["2026-08-14", "Receipt", "SGD", "20.50", "131.00"]);
    expect(() => parseTabular(source.sheets[0].rows, "GENERIC")).toThrow(/bertentangan/);
    expect(() => readMappedDetail(source, mapping)).toThrow(/bertentangan/);
  });
  it("checks declarations, custom mapped-header units and money symbols in the direct mapped reader", () => {
    const source = grid("Type", "Receipt");
    source.sheets[0].rows.unshift(["Currency: USD"]);
    expect(() => readMappedDetail(source, { ...mapping, firstRow: 3 })).toThrow(SourceCurrencyError);
    source.sheets[0].rows.shift();
    source.sheets[0].rows[0][3] = "Custom value (SGD)";
    expect(() => readMappedDetail(source, mapping)).toThrow(SourceCurrencyError);
    source.sheets[0].rows[0][3] = "Custom value";
    source.sheets[0].rows[1][3] = "$10.50";
    expect(() => readMappedDetail(source, mapping)).toThrow(SourceCurrencyError);
  });
  it("does not downgrade currency refusal to a remappable layout error", () => {
    const source = grid("Currency");
    const { sheet: _sheet, firstRow: _first, ...remembered } = mapping;
    void _sheet; void _first;
    const signature = signatureOf(source, mapping)!;
    expect(() => readWithLayout(source, [{ id: "fixture", label: "Custom", signature, mapping: remembered }])).toThrow(SourceCurrencyError);
  });
});

describe("PDF currency columns", () => {
  const page = (label: string, currency: string, offset = 0) => [
    ...table(800, [[[40, "Bank statement"]], [[40, "Period: 01/08/2026 - 31/08/2026"]]]),
    ...table(730, [
      [[40, "Date"], [130, "Description"], [300 + offset, label], [400, "Amount"], [510, "Balance"]],
      [[40, "13/08/2026"], [130, "USD customer services"], [300 + offset, currency], [400, "10.50"], [510, "110.50"]],
    ]),
  ];
  it.each(["Currency", "CCY", "Mata Uang"])("refuses USD under %s before converting amounts", async (label) => {
    await expect(parsePdf(makePdf([page(label, "USD")]))).rejects.toThrow(SourceCurrencyError);
  });
  it("accepts explicit IDR without misreading USD in a customer description", async () => {
    const statement = await parsePdf(makePdf([page("Currency", "IDR")]));
    expect(statement.currency).toBe("IDR");
    expect(statement.rows[0]).toMatchObject({ amount: 11n, description: "USD customer services" });
  });
  it("follows currency positions in a repeated header on the next page", async () => {
    await expect(parsePdf(makePdf([page("Currency", "IDR"), page("CCY", "SGD", 40)]))).rejects.toThrow(/bertentangan/);
  });
});


describe("strict PDF calendar dates", () => {
  it.each(["31/02", "31/02/2026", "29/02/2026"])("refuses %s rather than appending an impossible dated row to a valid transaction", async (invalidDate) => {
    const file = makePdf([[
      ...table(800, [[[40, "Bank statement"]], [[40, "Periode: Februari 2026"]]]),
      ...table(730, [
        [[40, "Date"], [130, "Description"], [400, "Amount"], [510, "Balance"]],
        [[40, "13/02/2026"], [130, "Valid receipt"], [400, "100"], [510, "1100"]],
        [[40, invalidDate], [130, "Invalid receipt"], [400, "200"], [510, "1300"]],
      ]),
    ]]);
    await expect(parseStatement("invalid-calendar.pdf", file)).rejects.toThrow(SourceDateError);
  });
});

describe("unambiguous amounts, dates and coverage", () => {
  const splitRows = (debit = "100", credit = "200") => [["Tanggal", "Keterangan", "Debit", "Credit", "Balance"], ["2026-08-13", "Receipt", debit, credit, "1100"]];
  it.each([["100", "200"], ["0.40", "0.40"]])("rejects simultaneous debit %s and credit %s before netting or rounding", (debit, credit) => {
    const source = splitRows(debit, credit);
    expect(() => parseTabular(source, "GENERIC")).toThrow(/sama-sama/);
    const grid: Grid = { kind: "CSV", pages: 0, sheets: [{ name: "", rows: source }] };
    expect(() => readMappedDetail(grid, { sheet: null, firstRow: 2, date: 0, description: [1], amount: { style: "split", debit: 2, credit: 3 }, balance: 4, order: "DMY" })).toThrow(/sama-sama/);
  });
  it("rejects both populated BRI columns", async () => {
    const text = "TGL_TRAN;DESK_TRAN;MUTASI_DEBET;MUTASI_KREDIT;SALDO_AKHIR_MUTASI\n2026-08-13;Receipt;100;200;1100";
    await expect(parseStatement("bri.csv", Buffer.from(text))).rejects.toThrow(/sama-sama/);
  });
  it("rejects both populated PDF columns", async () => {
    const file = makePdf([[
      ...table(800, [[[40, "Bank statement"]]]),
      ...table(730, [
        [[40, "Date"], [130, "Description"], [330, "Debit"], [410, "Credit"], [510, "Balance"]],
        [[40, "13/08/2026"], [130, "Receipt"], [330, "100"], [410, "200"], [510, "1100"]],
      ]),
    ]]);
    await expect(parseStatement("dual-side.pdf", file)).rejects.toThrow(/sama-sama/);
  });
  it("refuses ambiguous generic English dates while retaining a known Indonesian contract and explicit mapping", () => {
    const source = [["Date", "Description", "Amount", "Balance"], ["04/01/2026", "A", "100", "1100"], ["04/02/2026", "B", "200", "1300"]];
    expect(() => parseTabular(source, "GENERIC")).toThrow(/ambigu/);
    const declared = parseTabular([["Periode: 01/04/2026 - 30/04/2026"], ...source], "GENERIC");
    expect(declared.rows.map((r) => r.date.toISOString().slice(0, 10))).toEqual(["2026-04-01", "2026-04-02"]);
    const indonesian = source.map((r) => [...r]); indonesian[0][0] = "Tanggal";
    expect(parseTabular(indonesian, "GENERIC").rows[0].date.toISOString().slice(0, 10)).toBe("2026-01-04");
    const grid: Grid = { kind: "CSV", pages: 0, sheets: [{ name: "", rows: source }] };
    expect(readMappedDetail(grid, { sheet: null, firstRow: 2, date: 0, description: [1], amount: { style: "signed", column: 2, direction: null }, balance: 3, order: "MDY" }).statement.rows[0].date.toISOString().slice(0, 10)).toBe("2026-04-01");
  });
  it("does not claim a full declared period across a workbook gap", () => {
    const sheet = (name: string, start: string, end: string, date: string) => ({ name, rows: [[`Periode: ${start} - ${end}`], ["Date", "Description", "Amount", "Balance"], [date, "Receipt", "100", "1100"]] });
    const january = sheet("January", "01/01/2026", "31/01/2026", "2026-01-13");
    const march = sheet("March", "01/03/2026", "31/03/2026", "2026-03-13");
    expect(parseWorkbook([january, march])[0].provenance?.period).toBe("INFERRED");
    const february = sheet("February", "01/02/2026", "28/02/2026", "2026-02-13");
    expect(parseWorkbook([january, february, march])[0].provenance?.period).toBe("DECLARED");
  });
  it.each(["12abc34", "12,34,56", "1.23.456", "100.000,0,0"])("rejects malformed amount %s", (amount) => {
    expect(() => parseTabular([["Date", "Description", "Amount", "Balance"], ["2026-08-13", "Receipt", amount, "1100"]], "GENERIC")).toThrow(/Nominal/);
  });
});


describe("strict bank numeric grammar", () => {
  it.each([["1.234.567,50", 1234568n], ["1,234,567.50", 1234568n], ["1234567.50", 1234568n], ["-Rp 1.000", -1000n], ["(1,000.00)", -1000n], ["Rp -1000", -1000n], ["0,40", 0n], ["-", 0n]])("preserves supported amount %s", (value, expected) => {
    expect(parseBankAmount(value as string)).toBe(expected);
  });
  it("reads an ungrouped four-digit PDF amount and balance", async () => {
    const file = makePdf([[
      ...table(800, [[[40, "Bank statement"]]]),
      ...table(730, [
        [[40, "Date"], [130, "Description"], [400, "Amount"], [510, "Balance"]],
        [[40, "13/08/2026"], [130, "Receipt"], [400, "1000"], [510, "2000"]],
      ]),
    ]]);
    expect((await parsePdf(file)).rows[0]).toMatchObject({ amount: 1000n, balance: 2000n });
  });
  it("does not discard a malformed PDF amount just because the same row prints a valid balance", async () => {
    const file = makePdf([[
      ...table(800, [[[40, "Bank statement"]]]),
      ...table(730, [
        [[40, "Date"], [130, "Description"], [400, "Amount"], [510, "Balance"]],
        [[40, "13/08/2026"], [130, "Receipt"], [400, "12abc34"], [510, "2000"]],
      ]),
    ]]);
    await expect(parsePdf(file)).rejects.toThrow(/Nominal/);
  });
});


describe("generic PDF date order", () => {
  const file = (dates: string[], options: { period?: string; bank?: string; header?: string } = {}) => makePdf([[
    ...table(800, [[[40, options.bank ?? "Statement"]], ...(options.period ? [[[40, `Periode: ${options.period}`] as [number, string]]] : [])]),
    ...table(730, [
      [[40, options.header ?? "Date"], [130, "Description"], [400, "Amount"], [510, "Balance"]],
      ...dates.map((date, index): [number, string][] => [[40, date], [130, `Receipt ${index}`], [400, "100"], [510, String(1100 + index * 100)]]),
    ]),
  ]]);
  it("refuses an English Date table when both orders are equally possible", async () => {
    await expect(parseStatement("ambiguous.pdf", file(["04/01/2026", "04/02/2026"]))).rejects.toThrow(AmbiguousDateError);
  });
  it("uses a declared April period as independent evidence for month/day", async () => {
    const statement = await parsePdf(file(["04/01/2026", "04/02/2026"], { period: "01/04/2026 - 30/04/2026" }));
    expect(statement.rows.map((row) => row.date.toISOString().slice(0, 10))).toEqual(["2026-04-01", "2026-04-02"]);
  });
  it("uses declared period evidence even when transaction rows are not chronological", async () => {
    const statement = await parsePdf(file(["04/03/2026", "04/01/2026", "04/02/2026"], { period: "01/04/2026 - 30/04/2026" }));
    expect(statement.rows.map((row) => row.date.toISOString().slice(0, 10))).toEqual(["2026-04-03", "2026-04-01", "2026-04-02"]);
  });
  it("uses an unambiguous day and chronological order across the entire table", async () => {
    const unambiguous = await parsePdf(file(["04/01/2026", "04/13/2026"]));
    expect(unambiguous.rows.map((row) => row.date.toISOString().slice(0, 10))).toEqual(["2026-04-01", "2026-04-13"]);
    const chronological = await parsePdf(file(["03/01/2026", "03/05/2026", "04/02/2026"]));
    expect(chronological.rows.map((row) => row.date.toISOString().slice(0, 10))).toEqual(["2026-03-01", "2026-03-05", "2026-04-02"]);
  });
  it.each([{ header: "Tanggal" }, { bank: "BCA" }])("retains day-first for an Indonesian header or recognized bank contract %j", async (options) => {
    expect((await parsePdf(file(["04/01/2026", "04/02/2026"], options))).rows[0].date.toISOString().slice(0, 10)).toBe("2026-01-04");
  });
  it("allows the same PDF through explicit manual date-order mapping", async () => {
    const grid = await readGrid(file(["04/01/2026", "04/02/2026"]));
    const headerIndex = grid.sheets[0].rows.findIndex((row) => row.includes("Date"));
    const header = grid.sheets[0].rows[headerIndex];
    const result = readMappedDetail(grid, { sheet: null, firstRow: headerIndex + 2, date: header.indexOf("Date"), description: [header.indexOf("Description")], amount: { style: "signed", column: header.indexOf("Amount"), direction: null }, balance: header.indexOf("Balance"), order: "MDY" });
    expect(result.statement.rows.map((row) => row.date.toISOString().slice(0, 10))).toEqual(["2026-04-01", "2026-04-02"]);
  });
});
