import { describe, expect, it } from "vitest";
import { defaultLifeMonths, fiscalDepreciation, fiscalMethodAllowed, type FiscalAsset } from "@/lib/assets/fiscal";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const years = (a: FiscalAsset, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => fiscalDepreciation(a, from + i).depreciation);

describe("fiscal depreciation (PMK 72/2023)", () => {
  it("Kelompok 1 saldo menurun from July: 50 % pro rata, then 50 % of what is left, the rest in the year the life ends", () => {
    const laptop: FiscalAsset = { taxGroup: "KELOMPOK_1", fiscalMethod: "SALDO_MENURUN", acquiredOn: d("2024-07-15"), cost: 100_000_000n };
    expect(years(laptop, 2024, 2029)).toEqual([25_000_000n, 37_500_000n, 18_750_000n, 9_375_000n, 9_375_000n, 0n]);
    expect(fiscalDepreciation(laptop, 2028)).toMatchObject({ accumulated: 100_000_000n, bookValue: 0n });
    // Through June of a full year: half of that year's amount.
    expect(fiscalDepreciation(laptop, 2025, 6)).toMatchObject({ depreciation: 18_750_000n, accumulated: 43_750_000n, bookValue: 56_250_000n });
  });

  it("Kelompok 2 garis lurus: cost over 96 months from the month of acquisition", () => {
    const truck: FiscalAsset = { taxGroup: "KELOMPOK_2", fiscalMethod: "GARIS_LURUS", acquiredOn: d("2026-03-31"), cost: 96_000_000n };
    expect(fiscalDepreciation(truck, 2026)).toMatchObject({ depreciation: 10_000_000n, accumulated: 10_000_000n });
    expect(fiscalDepreciation(truck, 2026, 8).depreciation).toBe(6_000_000n);
    expect(fiscalDepreciation(truck, 2026, 2).depreciation).toBe(0n);
    expect(years(truck, 2026, 2034).reduce((s, x) => s + x, 0n)).toBe(96_000_000n);
  });

  it("rounds a straight-line year half up and leaves the rest to the year the life ends", () => {
    // 99 × 25 % × 6/12 = 12,375 → 12; 24,75 → 25; …; the last half year takes 99 − 87 = 12.
    const a: FiscalAsset = { taxGroup: "KELOMPOK_1", fiscalMethod: "GARIS_LURUS", acquiredOn: d("2026-07-01"), cost: 99n };
    expect(years(a, 2026, 2030)).toEqual([12n, 25n, 25n, 25n, 12n]);
    // A full year is exactly the rate on the cost (12,5 % of 100 jt), not twelve rounded months.
    expect(fiscalDepreciation({ taxGroup: "KELOMPOK_2", fiscalMethod: "GARIS_LURUS", acquiredOn: d("2023-01-10"), cost: 100_000_000n }, 2026).depreciation).toBe(12_500_000n);
  });

  it("buildings are straight line (5 % permanent, 10 % not); land is not depreciated", () => {
    expect(fiscalDepreciation({ taxGroup: "BANGUNAN_PERMANEN", fiscalMethod: "GARIS_LURUS", acquiredOn: d("2026-01-10"), cost: 240_000_000n }, 2026).depreciation).toBe(12_000_000n);
    expect(fiscalDepreciation({ taxGroup: "BANGUNAN_TIDAK_PERMANEN", fiscalMethod: "GARIS_LURUS", acquiredOn: d("2026-01-10"), cost: 120_000_000n }, 2026).depreciation).toBe(12_000_000n);
    expect(fiscalDepreciation({ taxGroup: "TANAH", fiscalMethod: "GARIS_LURUS", acquiredOn: d("2020-01-01"), cost: 500_000_000n }, 2026)).toEqual({ depreciation: 0n, accumulated: 0n, bookValue: 500_000_000n });
    expect(fiscalMethodAllowed("BANGUNAN_PERMANEN", "SALDO_MENURUN")).toBe(false);
    expect(fiscalMethodAllowed("KELOMPOK_3", "SALDO_MENURUN")).toBe(true);
    expect(defaultLifeMonths("KELOMPOK_3")).toBe(192);
    expect(defaultLifeMonths("TANAH")).toBeNull();
  });

  it("stops in the month of disposal", () => {
    const a: FiscalAsset = { taxGroup: "KELOMPOK_2", fiscalMethod: "GARIS_LURUS", acquiredOn: d("2026-01-05"), cost: 96_000_000n, disposedOn: d("2026-05-20") };
    expect(fiscalDepreciation(a, 2026).depreciation).toBe(5_000_000n);
    expect(fiscalDepreciation(a, 2027).depreciation).toBe(0n);
  });

  it("rounds a declining-balance year half up", () => {
    const a: FiscalAsset = { taxGroup: "KELOMPOK_1", fiscalMethod: "SALDO_MENURUN", acquiredOn: d("2026-12-01"), cost: 1_000_001n };
    // 1.000.001 × 50 % × 1/12 = 41.666,708… → 41.667
    expect(fiscalDepreciation(a, 2026).depreciation).toBe(41_667n);
  });
});
