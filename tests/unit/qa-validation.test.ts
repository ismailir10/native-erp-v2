import { describe, expect, it } from "vitest";
import { normalizeNpwp } from "@/lib/onboarding";
import { parsePeriod } from "@/lib/scope";

// QA 2026-10-02: BUG-011 and BUG-007 (docs/qa/bugs).
describe("normalizeNpwp (BUG-011)", () => {
  it("accepts 15 digits with or without separators and prints the standard form", () => {
    expect(normalizeNpwp("01.234.567.8-015.000")).toBe("01.234.567.8-015.000");
    expect(normalizeNpwp("012345678015000")).toBe("01.234.567.8-015.000");
    expect(normalizeNpwp(" 01 234 567 8 015 000 ")).toBe("01.234.567.8-015.000");
  });
  it("accepts the 16-digit NIK-based NPWP", () => expect(normalizeNpwp("0123456789012345")).toBe("0123456789012345"));
  it("blank stays blank (it is optional)", () => expect(normalizeNpwp("  ")).toBe(""));
  it.each(["123", "1234567890123456789", "1".repeat(25), "ABCDEFGHIJKLMNO", "01.234.567.8-015.00x", "01234567801500", "01234567890123456"])("refuses %s", (v) => expect(normalizeNpwp(v)).toBeNull());
});

describe("parsePeriod (BUG-007)", () => {
  const fallback = { year: 2026, month: 8 };
  it("reads a real period", () => expect(parsePeriod("2026-03", fallback)).toMatchObject({ year: 2026, month: 3, key: "2026-03" }));
  it.each(["2026-13", "2026-00", "abc", "2026-1", "1899-12", "2200-01", ""])("%s falls back to the default period", (v) => expect(parsePeriod(v, fallback)).toMatchObject({ year: 2026, month: 8, key: "2026-08" }));
  it("a missing or repeated parameter falls back too", () => {
    expect(parsePeriod(undefined, fallback).key).toBe("2026-08");
    expect(parsePeriod(["2026-01", "2026-02"], fallback).key).toBe("2026-08");
  });
});
