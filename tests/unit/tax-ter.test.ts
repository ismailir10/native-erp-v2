import { describe, expect, it } from "vitest";
import { formatTerRate, parsePtkp, pasal17, pph21Annual, pph21Ter, TER_CATEGORY, TER_TABLES, terRate } from "@/lib/tax/ter";

describe("PPh 21 TER (PP 58/2023)", () => {
  it("has the Lampiran's bracket counts, ascending, ending unbounded at 34 %", () => {
    expect(TER_TABLES.A).toHaveLength(44);
    expect(TER_TABLES.B).toHaveLength(40);
    expect(TER_TABLES.C).toHaveLength(41);
    for (const rows of Object.values(TER_TABLES)) {
      expect(rows[0][1]).toBe(0);
      expect(rows[rows.length - 1]).toEqual([null, 3400]);
      for (let i = 1; i < rows.length - 1; i++) {
        expect(rows[i][0]! > rows[i - 1][0]!).toBe(true);
        expect(rows[i][1] > rows[i - 1][1]).toBe(true);
      }
    }
  });

  it("maps PTKP status to its category", () => {
    expect([TER_CATEGORY.TK0, TER_CATEGORY.TK1, TER_CATEGORY.K0]).toEqual(["A", "A", "A"]);
    expect([TER_CATEGORY.TK2, TER_CATEGORY.TK3, TER_CATEGORY.K1, TER_CATEGORY.K2]).toEqual(["B", "B", "B", "B"]);
    expect(TER_CATEGORY.K3).toBe("C");
  });

  it("treats each upper bound as inclusive", () => {
    expect(terRate("A", 5_400_000n)).toBe(0);
    expect(terRate("A", 5_400_001n)).toBe(25);
    expect(terRate("B", 6_200_000n)).toBe(0);
    expect(terRate("B", 6_200_001n)).toBe(25);
    expect(terRate("C", 6_600_000n)).toBe(0);
    expect(terRate("C", 6_600_001n)).toBe(25);
    expect(terRate("A", 1_400_000_000n)).toBe(3300);
    expect(terRate("A", 1_400_000_001n)).toBe(3400);
  });

  it("computes the month's PPh 21, rounded down", () => {
    // TK/0, Rp 10.000.000: A 9.650.001–10.050.000 → 2 %.
    expect(pph21Ter(10_000_000n, "TK0")).toEqual({ category: "A", rate: 200, tax: 200_000n });
    // K/1, Rp 10.000.000: B 9.200.001–10.750.000 → 1,5 %.
    expect(pph21Ter(10_000_000n, "K1")).toEqual({ category: "B", rate: 150, tax: 150_000n });
    // K/3, Rp 20.000.000: C 19.500.001–22.700.000 → 8 %.
    expect(pph21Ter(20_000_000n, "K3")).toEqual({ category: "C", rate: 800, tax: 1_600_000n });
    // 0,25 % of 5.500.003 = 13.750,0075 → 13.750.
    expect(pph21Ter(5_500_003n, "TK0").tax).toBe(13_750n);
    expect(pph21Ter(0n, "TK0").tax).toBe(0n);
  });

  it("reads PTKP status as written in payroll files", () => {
    expect(parsePtkp("TK/0")).toBe("TK0");
    expect(parsePtkp(" k / 3 ")).toBe("K3");
    expect(parsePtkp("k1")).toBe("K1");
    expect(parsePtkp("K/4")).toBeNull();
    expect(parsePtkp("")).toBeNull();
  });

  it("formats rates the Indonesian way", () => {
    expect(formatTerRate(25)).toBe("0,25 %");
    expect(formatTerRate(150)).toBe("1,5 %");
    expect(formatTerRate(200)).toBe("2 %");
    expect(formatTerRate(3400)).toBe("34 %");
  });
});

describe("PPh 21 Desember (Pasal 17 setahun, PMK 168/2023)", () => {
  it("taxes PKP layer by layer under UU HPP", () => {
    expect(pasal17(0n)).toBe(0n);
    expect(pasal17(60_000_000n)).toBe(3_000_000n);
    expect(pasal17(111_000_000n)).toBe(10_650_000n);
    // 3 jt + 28,5 jt + 62,5 jt + 30 jt.
    expect(pasal17(600_000_000n)).toBe(124_000_000n);
    expect(pasal17(6_000_000_000n)).toBe(3_000_000n + 28_500_000n + 62_500_000n + 1_350_000_000n + 350_000_000n);
  });

  it("recomputes the year and leaves December the rest after TER (DJP's TK/0 Rp 10 jt example: Rp 800.000)", () => {
    expect(pph21Annual(10_000_000n, "TK0", 12)).toEqual({ months: 12, gross: 120_000_000n, biayaJabatan: 6_000_000n, neto: 114_000_000n, ptkp: 54_000_000n, pkp: 60_000_000n, annual: 3_000_000n, ter: 2_200_000n, december: 800_000n });
    // K/1 Rp 15 jt: PTKP 63 jt, PKP 111 jt → 10,65 jt; TER B 6 % × 11 = 9,9 jt.
    expect(pph21Annual(15_000_000n, "K1", 12)).toMatchObject({ ptkp: 63_000_000n, pkp: 111_000_000n, annual: 10_650_000n, ter: 9_900_000n, december: 750_000n });
  });

  it("counts only the months worked, caps biaya jabatan at Rp 500 rb a month, and can end in lebih potong", () => {
    // Hired in July: 6 months, bruto 60 jt, biaya jabatan 3 jt, PKP 3 jt → 150 rb; TER A 2 % × 5 = 1 jt → December − 850 rb.
    expect(pph21Annual(10_000_000n, "TK0", 6)).toMatchObject({ gross: 60_000_000n, biayaJabatan: 3_000_000n, pkp: 3_000_000n, annual: 150_000n, ter: 1_000_000n, december: -850_000n });
    // Under PTKP all year: no tax at all.
    expect(pph21Annual(4_000_000n, "K0", 12)).toMatchObject({ pkp: 0n, annual: 0n, ter: 0n, december: 0n });
  });
});
