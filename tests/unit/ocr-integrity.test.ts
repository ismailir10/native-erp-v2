import { describe, expect, it } from "vitest";
import { parseOcrTranscript, OCR_MAX_ROWS } from "@/lib/ocr/transcribe";
import { proveRows, type OcrRow } from "@/lib/ocr/prove";
import { draftCsv } from "@/lib/ocr/draft";
import { parseStatement } from "@/lib/import/parsers";

const textRow = { date: "2026-08-03", description: "Setoran", debit: "", credit: "100", balance: "1100" };
const transcript = { bank: "BCA", currency: "IDR", accountNumber: "111", periodStart: "2026-08-01", periodEnd: "2026-08-31", opening: "1000", closing: "1100", rows: [textRow] };
const row: OcrRow = { date: "2026-08-03", description: "Setoran", debit: null, credit: 100n, balance: 1100n };
const parse = (v: unknown) => parseOcrTranscript(JSON.stringify(v));

describe("OCR source integrity", () => {
  it("retains all rows at the limit and refuses one extra instead of truncating", () => {
    expect(parse({ ...transcript, rows: Array(OCR_MAX_ROWS).fill(textRow) }).rows).toHaveLength(OCR_MAX_ROWS);
    expect(() => parse({ ...transcript, rows: Array(OCR_MAX_ROWS + 1).fill(textRow) })).toThrow(/2.000/);
  });
  it.each([null, {}, "row", 4, { ...textRow, credit: 100 }, { date: textRow.date }])("refuses malformed row %j", (bad) => {
    expect(() => parse({ ...transcript, rows: [textRow, bad] })).toThrow(/Baris 2/);
  });
  it.each([null, {}, "rows"])("refuses invalid rows container %j", (rows) => {
    expect(() => parse({ ...transcript, rows })).toThrow(/daftar transaksi/);
  });
  it("refuses currency before converting amounts, including units embedded in amounts", () => {
    expect(() => parse({ ...transcript, currency: "USD", opening: "10.50" })).toThrow(/USD/);
    expect(() => parse({ ...transcript, currency: "", opening: "USD 10.50" })).toThrow(/USD/);
    expect(() => parse({ ...transcript, currency: "XYZ" })).toThrow(/XYZ/);
    expect(parse(transcript).currency).toBe("IDR");
  });
  it("requires header balances as strings so large JSON numbers cannot lose precision", () => {
    expect(() => parse({ ...transcript, opening: 9007199254740992 })).toThrow(/teks/);
  });
  it("does not discard unreadable nonempty amounts and expose a remaining valid side", () => {
    expect(() => parse({ ...transcript, rows: [{ ...textRow, debit: "1O0" }] })).toThrow(/tidak terbaca/);
    expect(() => parse({ ...transcript, closing: "1O00" })).toThrow(/tidak terbaca/);
  });
  it("requires a printed closing for OCR while mapped files retain optional closing", () => {
    expect(proveRows([row], 1000n, null, { requireClosing: true })).toMatchObject({ importable: false, problems: 1 });
    expect(proveRows([row], 1000n, null, { chained: true })).toMatchObject({ importable: true });
    expect(proveRows([row], 1000n, 1100n, { requireClosing: true })).toMatchObject({ importable: true });
  });
  it.each([{ debit: 100n, credit: 200n }, { debit: -100n, credit: null }, { debit: null, credit: -100n, balance: 900n }])("rejects nettable malformed amounts case %#", (amounts) => {
    expect(proveRows([{ ...row, ...amounts }], 1000n, null).rows[0].state).toBe("BAD_AMOUNT");
  });
  it("preserves independently printed period and closing through the public parser", async () => {
    const csv = draftCsv([row], 1000n, { closing: 1100n, currency: "IDR", period: { start: "2026-08-01", end: "2026-08-31" } });
    const statement = await parseStatement("scan.csv", Buffer.from(csv));
    expect(statement.periodStart.toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(statement.periodEnd.toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(statement.closingBalance).toBe(1100n);
    expect(statement.provenance).toEqual({ period: "DECLARED", opening: "PRINTED", closing: "PRINTED" });
    const mapped = await parseStatement("mapped.csv", Buffer.from(draftCsv([row], 1000n)));
    expect(mapped.provenance?.period).toBe("INFERRED");
  });
  it.each([{ start: "2026-02-30", end: "2026-08-31" }, { start: "2026-08-31", end: "2026-08-01" }, { start: "2026-08-04", end: "2026-08-31" }])("rejects invalid or incompatible declared period %j", (period) => {
    expect(() => draftCsv([row], 1000n, { closing: 1100n, period })).toThrow(/Periode scan/);
  });
});
