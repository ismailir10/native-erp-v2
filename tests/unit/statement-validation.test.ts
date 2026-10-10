import { describe, expect, it } from "vitest";
import { dateOnly } from "@/lib/format";
import { repairStatement, checkContinuity } from "@/lib/import/normalize";
import { validateStatement, readValidation } from "@/lib/import/validation";
import { SourceDateError, type ParsedStatement, type ParsedRow } from "@/lib/import/types";

const row = (day: number, amount: bigint, balance: bigint | null, extra: Partial<ParsedRow> = {}): ParsedRow => ({ date: dateOnly(2026, 8, day), amount, balance, description: "SYNTHETIC", rowNumber: day, rawRow: "source", ...extra });
const statement = (rows = [row(1, 100n, 1100n)], closing = 1100n): ParsedStatement => ({ format: "GENERIC", currency: "IDR", accountNumber: "123456789", periodStart: dateOnly(2026, 8, 1), periodEnd: dateOnly(2026, 8, 31), openingBalance: 1000n, closingBalance: closing, rows, provenance: { period: "DECLARED", opening: "PRINTED", closing: "PRINTED" } });
const codes = (st: ParsedStatement) => validateStatement(st).issues.map((i) => i.code);

describe("independent statement evidence", () => {
  it("never replaces a contradictory printed closing with the last row", () => {
    const original = statement(undefined, 900n);
    const repaired = repairStatement(original);
    expect(repaired.closingBalance).toBe(900n);
    expect(checkContinuity(repaired).ok).toBe(false);
    expect(validateStatement(repaired).source.closingBalance).toBe("900");
    expect(codes(repaired)).toContain("BALANCE_CONFLICT");
    expect(original.closingBalance).toBe(900n);
  });

  it("rejects a direction repair whose row chain would conflict with the printed closing", () => {
    const repaired = repairStatement(statement([row(1, 100n, 900n), row(2, 100n, 1000n)], 1100n));
    expect(repaired.rows.map((r) => r.amount)).toEqual([100n, 100n]);
    expect(repaired.rows.every((r) => !r.written)).toBe(true);
    expect(repaired.closingBalance).toBe(1100n);
    expect(codes(repaired)).toContain("BALANCE_CONFLICT");
  });

  it("allows a fully proved direction repair while preserving review status", () => {
    const repaired = repairStatement(statement([row(1, 100n, 900n), row(2, 100n, 1000n)], 1000n));
    expect(repaired.rows[0]).toMatchObject({ amount: -100n, written: { amount: 100n } });
    expect(checkContinuity(repaired).ok).toBe(true);
    expect(validateStatement(repaired).issues).toEqual([expect.objectContaining({ code: "ROWS_REPAIRED", severity: "UNVERIFIED" })]);
  });

  it("retains an unresolved balance-only row instead of hiding missing gross movement", () => {
    const repaired = repairStatement(statement([row(1, 100n, 1100n), row(2, 0n, 900n, { balanceOnly: true }), row(3, 100n, 1200n)], 1200n));
    expect(repaired.rows).toHaveLength(3);
    expect(repaired.rows[1]).toMatchObject({ amount: 0n, balanceOnly: true, balance: 900n });
    expect(codes(repaired)).toEqual(expect.arrayContaining(["BALANCE_CONFLICT", "AMOUNT_UNRESOLVED"]));
  });

  it("does not treat a calculated opening, closing, or period as independent proof", () => {
    const st = { ...statement(), provenance: { period: "INFERRED", opening: "DERIVED", closing: "DERIVED" } as const };
    expect(codes(st)).toEqual(["PERIOD_INFERRED", "OPENING_DERIVED", "CLOSING_DERIVED"]);
    expect(validateStatement({ ...statement(), provenance: undefined }).issues).toHaveLength(3);
  });

  it("flags a last row balance before the end of the printed period", () => {
    expect(codes({ ...statement(), provenance: { period: "DECLARED", opening: "PRINTED", closing: "ROW" } })).toEqual(["CLOSING_BEFORE_END"]);
    expect(codes({ ...statement([row(31, 100n, 1100n)]), provenance: { period: "DECLARED", opening: "PRINTED", closing: "ROW" } })).toEqual([]);
  });

  it("refuses dates outside a declared period even when a year repair looks plausible", () => {
    const st = statement([row(1, 100n, 1100n, { date: dateOnly(2023, 8, 1) }), row(2, 100n, 1200n), row(3, 100n, 1300n)], 1300n);
    expect(() => repairStatement(st)).toThrow(SourceDateError);
    expect(() => repairStatement(st)).toThrow(/di luar periode tercetak/);
  });

  it("refuses a reversed or invalid declared period", () => {
    expect(() => repairStatement({ ...statement(), periodStart: dateOnly(2026, 9, 1) })).toThrow(SourceDateError);
    expect(() => repairStatement({ ...statement(), periodEnd: new Date(NaN) })).toThrow(SourceDateError);
  });
});

describe("persisted validation decoding", () => {
  it("round trips JSON without bigint or Date values and retains the exact source hash", () => {
    const value = validateStatement(statement(), "a".repeat(64));
    expect(readValidation(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(readValidation(validateStatement(statement()))).toEqual(validateStatement(statement()));
  });

  it.each([null, undefined, {}, [], { version: 0 }, { version: 1, source: {}, issues: [] }])("treats legacy or malformed evidence as unknown: %j", (value) => {
    expect(readValidation(value)).toBeNull();
  });

  it.each([
    { sourceHash: "wrong" },
    { source: { ...validateStatement(statement()).source, openingBalance: 1000 } },
    { source: { ...validateStatement(statement()).source, closingBalance: "1100.50" } },
    { source: { ...validateStatement(statement()).source, currency: undefined } },
    { issues: [{ code: "BAD", severity: "PASS", message: "invalid" }] },
  ])("rejects invalid persisted fields", (fields) => {
    expect(readValidation({ ...validateStatement(statement()), ...fields })).toBeNull();
  });
});
