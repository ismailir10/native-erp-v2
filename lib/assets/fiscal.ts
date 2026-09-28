import type { AssetTaxGroup, FiscalMethod } from "@/lib/generated/prisma/enums";

/**
 * Fiscal depreciation estimate (accounting-rules 5b): UU PPh Pasal 11 with the groups of PMK 72/2023. It starts in the month of
 * acquisition; straight line spreads the cost evenly over the fiscal life in months; declining balance applies the group's rate to
 * the fiscal book value at the start of each year (the first year pro rata by months) and takes what is left in full in the year the
 * life ends. Buildings are straight line only, land is not depreciated. Pure bigint math in minor units — a figure for the tax
 * computation (koreksi fiskal), never posted.
 */
export type TaxGroupInfo = { label: string; lifeYears: number | null; straightBp: number | null; decliningBp: number | null };

export const TAX_GROUPS: Record<AssetTaxGroup, TaxGroupInfo> = {
  KELOMPOK_1: { label: "Kelompok 1 (4 tahun)", lifeYears: 4, straightBp: 2500, decliningBp: 5000 },
  KELOMPOK_2: { label: "Kelompok 2 (8 tahun)", lifeYears: 8, straightBp: 1250, decliningBp: 2500 },
  KELOMPOK_3: { label: "Kelompok 3 (16 tahun)", lifeYears: 16, straightBp: 625, decliningBp: 1250 },
  KELOMPOK_4: { label: "Kelompok 4 (20 tahun)", lifeYears: 20, straightBp: 500, decliningBp: 1000 },
  BANGUNAN_PERMANEN: { label: "Bangunan permanen (20 tahun)", lifeYears: 20, straightBp: 500, decliningBp: null },
  BANGUNAN_TIDAK_PERMANEN: { label: "Bangunan tidak permanen (10 tahun)", lifeYears: 10, straightBp: 1000, decliningBp: null },
  TANAH: { label: "Tanah (tidak disusutkan)", lifeYears: null, straightBp: null, decliningBp: null },
};

export const FISCAL_METHOD_LABEL: Record<FiscalMethod, string> = { GARIS_LURUS: "Garis lurus", SALDO_MENURUN: "Saldo menurun" };

/** Book useful life suggested for a group (the accountant may use another estimate, PSAK 16); null for land. */
export const defaultLifeMonths = (group: AssetTaxGroup) => (TAX_GROUPS[group].lifeYears === null ? null : TAX_GROUPS[group].lifeYears! * 12);

/** The fiscal method a group allows: buildings straight line only, land none. */
export function fiscalMethodAllowed(group: AssetTaxGroup, method: FiscalMethod) {
  return method === "GARIS_LURUS" ? TAX_GROUPS[group].straightBp !== null || group === "TANAH" : TAX_GROUPS[group].decliningBp !== null;
}

export type FiscalAsset = { taxGroup: AssetTaxGroup; fiscalMethod: FiscalMethod; acquiredOn: Date; cost: bigint; disposedOn?: Date | null };

const monthIndex = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();
/** a / b rounded half up, both ≥ 0. */
const halfUp = (a: bigint, b: bigint) => (2n * a + b) / (2n * b);

/** Fiscal depreciation per month index (year × 12 + month − 1), from acquisition to the end of life or the disposal month. */
function monthly(asset: FiscalAsset): Map<number, bigint> {
  const info = TAX_GROUPS[asset.taxGroup];
  const out = new Map<number, bigint>();
  if (info.lifeYears === null) return out;
  const first = monthIndex(asset.acquiredOn);
  const lifeMonths = info.lifeYears * 12;
  const lastOfLife = first + lifeMonths - 1;
  const stop = asset.disposedOn ? Math.min(lastOfLife, monthIndex(asset.disposedOn)) : lastOfLife;
  if (asset.fiscalMethod === "GARIS_LURUS" || info.decliningBp === null) {
    const base = asset.cost / BigInt(lifeMonths);
    for (let m = first; m <= stop; m++) out.set(m, m === lastOfLife ? asset.cost - base * BigInt(lifeMonths - 1) : base);
    return out;
  }
  // Declining balance: one amount per year, spread evenly over that year's months (the remainder on its last month).
  let bookValue = asset.cost;
  for (let year = Math.floor(first / 12); year * 12 <= lastOfLife; year++) {
    const from = Math.max(first, year * 12);
    const to = Math.min(lastOfLife, year * 12 + 11);
    const months = to - from + 1;
    const annual = to === lastOfLife ? bookValue : halfUp(bookValue * BigInt(info.decliningBp) * BigInt(months), 10_000n * 12n);
    const base = annual / BigInt(months);
    for (let m = from; m <= to; m++) if (m <= stop) out.set(m, m === to ? annual - base * BigInt(months - 1) : base);
    bookValue -= annual;
  }
  return out;
}

export type FiscalYear = {
  /** Fiscal depreciation from January through `throughMonth` of the year. */
  depreciation: bigint;
  /** Accumulated fiscal depreciation at the end of `throughMonth`. */
  accumulated: bigint;
  /** Cost − accumulated. */
  bookValue: bigint;
};

/** Fiscal depreciation of a year through a month (1–12), and the accumulated amount and fiscal book value at that point. */
export function fiscalDepreciation(asset: FiscalAsset, year: number, throughMonth = 12): FiscalYear {
  const through = year * 12 + throughMonth - 1;
  let depreciation = 0n;
  let accumulated = 0n;
  for (const [m, amount] of monthly(asset)) {
    if (m > through) continue;
    accumulated += amount;
    if (m >= year * 12) depreciation += amount;
  }
  return { depreciation, accumulated, bookValue: asset.cost - accumulated };
}
