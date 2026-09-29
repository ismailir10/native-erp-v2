import { describe, expect, it } from "vitest";
import { corporateTax, deferredTax, roundDownThousands, settlement } from "@/lib/tax/compute";

describe("PPh badan arithmetic", () => {
  it("rounds PKP down to full thousands; a loss is zero", () => {
    expect(roundDownThousands(123_456_789n)).toBe(123_456_000n);
    expect(roundDownThousands(999n)).toBe(0n);
    expect(roundDownThousands(-5_000_000n)).toBe(0n);
  });

  it("taxes all of PKP at 11 % when turnover is at most Rp 4,8 M (Pasal 31E)", () => {
    expect(corporateTax({ regime: "NORMAL", pkp: 500_000_000n, turnover: 3_000_000_000n })).toMatchObject({ facilityPkp: 500_000_000n, facilityTax: 55_000_000n, regularPkp: 0n, due: 55_000_000n });
  });

  it("splits PKP by 4,8 M ÷ turnover between 11 % and 22 % up to Rp 50 M turnover", () => {
    // Turnover 10 M, PKP 1 M: 480 jt at 11 % = 52,8 jt; 520 jt at 22 % = 114,4 jt.
    expect(corporateTax({ regime: "NORMAL", pkp: 1_000_000_000n, turnover: 10_000_000_000n })).toMatchObject({ facilityPkp: 480_000_000n, facilityTax: 52_800_000n, regularPkp: 520_000_000n, regularTax: 114_400_000n, due: 167_200_000n });
    // Exactly 50 M still qualifies: 1 M × 4,8/50 = 96 jt.
    expect(corporateTax({ regime: "NORMAL", pkp: 1_000_000_000n, turnover: 50_000_000_000n }).facilityPkp).toBe(96_000_000n);
    // Above 50 M: 22 % on everything.
    expect(corporateTax({ regime: "NORMAL", pkp: 1_000_000_000n, turnover: 50_000_000_001n })).toMatchObject({ facilityPkp: 0n, due: 220_000_000n });
  });

  it("rounds each part down to Rupiah", () => {
    // 1.000 × 4,8 M / 7 M = 685,71… → 685; 685 × 11 % = 75,35 → 75; 315 × 22 % = 69,3 → 69.
    expect(corporateTax({ regime: "NORMAL", pkp: 1_000n, turnover: 7_000_000_000n })).toMatchObject({ facilityPkp: 685n, facilityTax: 75n, regularPkp: 315n, regularTax: 69n, due: 144n });
  });

  it("computes the PP 55/2022 final tax as 0,5 % of turnover, rounded down", () => {
    expect(corporateTax({ regime: "FINAL_UMKM", pkp: 999_000n, turnover: 1_234_567_890n })).toMatchObject({ pkp: 0n, due: 6_172_839n });
  });

  it("settles against credits: kurang bayar, lebih bayar, and next year's PPh 25", () => {
    expect(settlement({ due: 167_200_000n, instalments: 60_000_000n, withheld: 20_000_000n })).toEqual({ credits: 80_000_000n, balance: 87_200_000n, nextInstalment: 12_266_666n });
    expect(settlement({ due: 10_000_000n, instalments: 12_000_000n, withheld: 0n })).toMatchObject({ balance: -2_000_000n, nextInstalment: 833_333n });
    expect(settlement({ due: 5_000_000n, instalments: 0n, withheld: 6_000_000n }).nextInstalment).toBe(0n);
  });

  it("puts deferred tax at 22 % of the temporary difference, asset when fiscal value is higher", () => {
    expect(deferredTax(10_000_000n)).toBe(2_200_000n);
    expect(deferredTax(-10_000_000n)).toBe(-2_200_000n);
  });
});
