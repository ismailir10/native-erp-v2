/**
 * PPh 21 tarif efektif rata-rata (TER) bulanan, PP 58/2023 Lampiran and PMK 168/2023 (accounting-rules 5j). A month's PPh 21 for
 * January–November is the month's gross income times the rate of the bracket it falls in; December is recomputed under Pasal 17 for
 * the year, so no TER applies. Each bracket is [upper bound in whole Rupiah, inclusive (null = no bound), rate in hundredths of a
 * percent]. The tables were checked bracket by bracket against two independent published implementations.
 */
export type PtkpStatus = "TK0" | "TK1" | "TK2" | "TK3" | "K0" | "K1" | "K2" | "K3";
export type TerCategory = "A" | "B" | "C";

export const PTKP_STATUSES: PtkpStatus[] = ["TK0", "TK1", "TK2", "TK3", "K0", "K1", "K2", "K3"];
export const PTKP_LABEL: Record<PtkpStatus, string> = { TK0: "TK/0", TK1: "TK/1", TK2: "TK/2", TK3: "TK/3", K0: "K/0", K1: "K/1", K2: "K/2", K3: "K/3" };

/** PTKP status → TER category (PP 58/2023 Pasal 2 ayat 3). */
export const TER_CATEGORY: Record<PtkpStatus, TerCategory> = { TK0: "A", TK1: "A", K0: "A", TK2: "B", TK3: "B", K1: "B", K2: "B", K3: "C" };

export const TER_TABLES: Record<TerCategory, [bigint | null, number][]> = {
  A: [[5_400_000n, 0], [5_650_000n, 25], [5_950_000n, 50], [6_300_000n, 75], [6_750_000n, 100], [7_500_000n, 125], [8_550_000n, 150], [9_650_000n, 175], [10_050_000n, 200], [10_350_000n, 225], [10_700_000n, 250], [11_050_000n, 300], [11_600_000n, 350], [12_500_000n, 400], [13_750_000n, 500], [15_100_000n, 600], [16_950_000n, 700], [19_750_000n, 800], [24_150_000n, 900], [26_450_000n, 1000], [28_000_000n, 1100], [30_050_000n, 1200], [32_400_000n, 1300], [35_400_000n, 1400], [39_100_000n, 1500], [43_850_000n, 1600], [47_800_000n, 1700], [51_400_000n, 1800], [56_300_000n, 1900], [62_200_000n, 2000], [68_600_000n, 2100], [77_500_000n, 2200], [89_000_000n, 2300], [103_000_000n, 2400], [125_000_000n, 2500], [157_000_000n, 2600], [206_000_000n, 2700], [337_000_000n, 2800], [454_000_000n, 2900], [550_000_000n, 3000], [695_000_000n, 3100], [910_000_000n, 3200], [1_400_000_000n, 3300], [null, 3400]],
  B: [[6_200_000n, 0], [6_500_000n, 25], [6_850_000n, 50], [7_300_000n, 75], [9_200_000n, 100], [10_750_000n, 150], [11_250_000n, 200], [11_600_000n, 250], [12_600_000n, 300], [13_600_000n, 400], [14_950_000n, 500], [16_400_000n, 600], [18_450_000n, 700], [21_850_000n, 800], [26_000_000n, 900], [27_700_000n, 1000], [29_350_000n, 1100], [31_450_000n, 1200], [33_950_000n, 1300], [37_100_000n, 1400], [41_100_000n, 1500], [45_800_000n, 1600], [49_500_000n, 1700], [53_800_000n, 1800], [58_500_000n, 1900], [64_000_000n, 2000], [71_000_000n, 2100], [80_000_000n, 2200], [93_000_000n, 2300], [109_000_000n, 2400], [129_000_000n, 2500], [163_000_000n, 2600], [211_000_000n, 2700], [374_000_000n, 2800], [459_000_000n, 2900], [555_000_000n, 3000], [704_000_000n, 3100], [957_000_000n, 3200], [1_405_000_000n, 3300], [null, 3400]],
  C: [[6_600_000n, 0], [6_950_000n, 25], [7_350_000n, 50], [7_800_000n, 75], [8_850_000n, 100], [9_800_000n, 125], [10_950_000n, 150], [11_200_000n, 175], [12_050_000n, 200], [12_950_000n, 300], [14_150_000n, 400], [15_550_000n, 500], [17_050_000n, 600], [19_500_000n, 700], [22_700_000n, 800], [26_600_000n, 900], [28_100_000n, 1000], [30_100_000n, 1100], [32_600_000n, 1200], [35_400_000n, 1300], [38_900_000n, 1400], [43_000_000n, 1500], [47_400_000n, 1600], [51_200_000n, 1700], [55_800_000n, 1800], [60_400_000n, 1900], [66_700_000n, 2000], [74_500_000n, 2100], [83_200_000n, 2200], [95_600_000n, 2300], [110_000_000n, 2400], [134_000_000n, 2500], [169_000_000n, 2600], [221_000_000n, 2700], [390_000_000n, 2800], [463_000_000n, 2900], [561_000_000n, 3000], [709_000_000n, 3100], [965_000_000n, 3200], [1_419_000_000n, 3300], [null, 3400]],
};

/** "TK/0", "tk0", "K / 3" → the status; anything else → null. */
export function parsePtkp(text: string | null | undefined): PtkpStatus | null {
  const m = (text ?? "").toUpperCase().replace(/\s+/g, "").match(/^(TK|K)\/?([0-3])$/);
  return m ? (`${m[1]}${m[2]}` as PtkpStatus) : null;
}

/** The rate (hundredths of a percent) of a month's gross income in a category. */
export function terRate(category: TerCategory, gross: bigint): number {
  for (const [upper, rate] of TER_TABLES[category]) if (upper === null || gross <= upper) return rate;
  throw new Error("unreachable: the last TER bracket has no bound");
}

/** PPh 21 of a month (January–November) under TER: gross × rate, rounded down to whole Rupiah; nothing on a gross ≤ 0. */
export function pph21Ter(gross: bigint, status: PtkpStatus): { category: TerCategory; rate: number; tax: bigint } {
  const category = TER_CATEGORY[status];
  if (gross <= 0n) return { category, rate: 0, tax: 0n };
  const rate = terRate(category, gross);
  return { category, rate, tax: (gross * BigInt(rate)) / 10_000n };
}

/** "0,25 %", "2 %", "34 %". */
export function formatTerRate(rate: number): string {
  const whole = Math.floor(rate / 100);
  const frac = rate % 100;
  return `${whole}${frac ? `,${String(frac).padStart(2, "0").replace(/0$/, "")}` : ""} %`;
}
