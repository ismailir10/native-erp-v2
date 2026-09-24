import { describe, expect, it } from "vitest";
import { formatRupiah, parseRupiah, splitPpn } from "@/lib/money";

describe("parseRupiah", () => {
  it.each([
    ["1.234.567,00", 1234567n],
    ["1,234,567.00", 1234567n],
    ["1500000.00", 1500000n],
    ["2.500", 2500n],
    ["-2.500", -2500n],
    ["(2.500)", -2500n],
    ["Rp 10.000,50", 10001n],
    ["", 0n],
    ["999,99", 1000n],
  ])("%s → %s", (input, expected) => {
    expect(parseRupiah(input)).toBe(expected);
  });

  it("rejects garbage", () => {
    expect(() => parseRupiah("12a4")).toThrow();
  });
});

describe("splitPpn", () => {
  it("always sums back to gross", () => {
    for (const g of [111n, 1_110_000n, 12_345_679n, -5_550_000n, 1n]) {
      const { dpp, ppn } = splitPpn(g);
      expect(dpp + ppn).toBe(g);
    }
  });
  it("11% effective", () => {
    expect(splitPpn(11_100_000n)).toEqual({ dpp: 10_000_000n, ppn: 1_100_000n });
  });
});

describe("formatRupiah", () => {
  it("formats id-ID with accounting negatives", () => {
    expect(formatRupiah(1234567n)).toBe("Rp 1.234.567");
    expect(formatRupiah(-5000n, { accounting: true })).toBe("(Rp 5.000)");
  });
});
