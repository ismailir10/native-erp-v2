import { describe, expect, it } from "vitest";
import { MoneyError, parseCents, parseMoney, parseRupiah } from "@/lib/money";
import { normalizeLedgerRate, normalizeRateInput } from "@/lib/fx/currency";

// QA 2026-10-02: BUG-003, BUG-005, BUG-006, BUG-010 (docs/qa/bugs).
describe("typed amounts: English thousands separators are refused, never read as a fraction (BUG-003)", () => {
  it.each(["1,000", "250,000", "12,500", "999,999"])("IDR %s asks for dots instead of becoming a tiny number", (v) => {
    expect(() => parseMoney(v, "IDR")).toThrow(MoneyError);
    expect(() => parseMoney(v, "IDR")).toThrow(/titik/);
  });
  it("two-decimal currencies refuse a three-digit fraction too, but keep real decimals", () => {
    expect(() => parseMoney("1,000", "SGD")).toThrow(MoneyError);
    expect(parseMoney("1.250,50", "SGD")).toBe(125_050n);
    expect(parseMoney("12,5", "SGD")).toBe(1_250n);
  });
  it("Indonesian notation is unchanged", () => {
    expect(parseMoney("250.000", "IDR")).toBe(250_000n);
    expect(parseMoney("1.000.000", "IDR")).toBe(1_000_000n);
    expect(parseMoney("1.250.000,00", "IDR")).toBe(1_250_000n);
    expect(parseMoney("1000000", "IDR")).toBe(1_000_000n);
    expect(parseMoney("(2.500)", "IDR")).toBe(-2_500n);
  });
});

describe("amounts beyond 15 digits are refused with a clear message (BUG-010)", () => {
  it("typed", () => {
    expect(() => parseMoney("99.999.999.999.999.999.999", "IDR")).toThrow(/terlalu besar/);
    expect(parseMoney("999.999.999.999.999", "IDR")).toBe(999_999_999_999_999n);
  });
  it("file parsers stay uncapped (evidence reads source-reported figures of any size); the import pipeline caps statement rows", () => {
    expect(parseRupiah("999.999.999.999.999.999")).toBe(999_999_999_999_999_999n);
    expect(parseCents("99999999999999999999.00")).toBe(9_999_999_999_999_999_999_900n);
  });
});

describe("rates: pair-aware reading of look-alike thousands (BUG-005)", () => {
  const usdIdr = { currency: "USD", quote: "IDR" };
  it("a leading zero is a fraction", () => expect(normalizeRateInput("0.745", { currency: "SGD", quote: "USD" })).toBe("0.745"));
  it("a rate between two foreign currencies is never in the thousands", () => {
    expect(normalizeRateInput("1.085", { currency: "EUR", quote: "USD" })).toBe("1.085");
    expect(normalizeRateInput("1,085", { currency: "EUR", quote: "USD" })).toBe("1.085");
  });
  it("against Rupiah the plausible reading wins", () => {
    expect(normalizeRateInput("16.250", usdIdr)).toBe("16250");
    expect(normalizeRateInput("105.234", { currency: "JPY", quote: "IDR" })).toBe("105.234");
    expect(normalizeRateInput("12.250", { currency: "SGD", quote: "IDR" })).toBe("12250");
    expect(normalizeRateInput("0,000062", { currency: "IDR", quote: "USD" })).toBe("0.000062");
  });
  it("unchanged without a pair, and with both separators", () => {
    expect(normalizeRateInput("16.250")).toBe("16250");
    expect(normalizeRateInput("16.250,50", usdIdr)).toBe("16250.50");
    expect(normalizeRateInput("16,250.50", usdIdr)).toBe("16250.50");
    expect(normalizeRateInput("1,31")).toBe("1.31");
  });
});

describe("ledger-file text rates (BUG-006)", () => {
  it("Indonesian text rate keeps its decimal", () => {
    expect(normalizeLedgerRate("15.750,50")).toBe("15750.50");
    expect(normalizeLedgerRate("15,750.50")).toBe("15750.50");
  });
  it("single separators behave as before", () => {
    expect(normalizeLedgerRate("1.31")).toBe("1.31");
    expect(normalizeLedgerRate("1.085")).toBe("1.085");
    expect(normalizeLedgerRate("15750.5")).toBe("15750.5");
    expect(normalizeLedgerRate("15,750")).toBe("15750");
    expect(normalizeLedgerRate("1,31")).toBe("1.31");
  });
});
