import { describe, expect, it } from "vitest";
import { convertMinor, divRound, exponentOf, formatRate, invertRate, isCurrency, parseRate } from "@/lib/fx/currency";

describe("currency registry", () => {
  it("knows exponents and rejects unknown codes", () => {
    expect(exponentOf("IDR")).toBe(0);
    expect(exponentOf("JPY")).toBe(0);
    expect(exponentOf("SGD")).toBe(2);
    expect(isCurrency("USD")).toBe(true);
    expect(isCurrency("XYZ")).toBe(false);
    expect(() => exponentOf("XYZ")).toThrow(/belum didukung/);
  });
});

describe("rates", () => {
  it("parses decimal rates without floats", () => {
    expect(parseRate("1.31")).toEqual({ num: 131n, scale: 2 });
    expect(parseRate("11,245.50")).toEqual({ num: 1124550n, scale: 2 });
    expect(parseRate("11245")).toEqual({ num: 11245n, scale: 0 });
    expect(parseRate("0,75")).toEqual({ num: 75n, scale: 2 });
    expect(() => parseRate("abc")).toThrow(/tidak valid/);
    expect(() => parseRate("0")).toThrow(/nol/);
  });

  it("formats canonically", () => {
    expect(formatRate("1.3100")).toBe("1.31");
    expect(formatRate("12000.00")).toBe("12000");
    expect(formatRate("0.000075")).toBe("0.000075");
  });

  it("rounds half away from zero", () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 3n)).toBe(1n);
    expect(divRound(-4n, 3n)).toBe(-1n);
  });

  it("converts across exponents", () => {
    // USD 150,000.00 @ 1.31 SGD = SGD 196,500.00
    expect(convertMinor(15_000_000n, "USD", "SGD", "1.31")).toBe(19_650_000n);
    // USD 44.97 @ 1.31 = SGD 58.9107 → 58.91
    expect(convertMinor(4_497n, "USD", "SGD", "1.31")).toBe(5_891n);
    // SGD 100.00 @ 12,000 IDR = Rp 1,200,000
    expect(convertMinor(10_000n, "SGD", "IDR", "12000")).toBe(1_200_000n);
    // JPY 12,750 @ 112.20 IDR = Rp 1,430,550
    expect(convertMinor(12_750n, "JPY", "IDR", "112.20")).toBe(1_430_550n);
    // Rp 1,000,000 @ 0.0000833 SGD per IDR = SGD 83.30
    expect(convertMinor(1_000_000n, "IDR", "SGD", "0.0000833")).toBe(8_330n);
  });

  it("inverts rates", () => {
    expect(invertRate("12500", 8)).toBe("0.00008");
    expect(invertRate("4", 2)).toBe("0.25");
  });
});
