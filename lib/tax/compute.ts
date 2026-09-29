import type { TaxRegime } from "@/lib/generated/prisma/enums";

/**
 * PPh badan arithmetic (accounting-rules 5d), pure bigint in whole Rupiah. An estimate for the accountant's working papers, never an SPT.
 * - PKP rounds down to full thousands; a loss gives 0 (carry-forward is out of scope).
 * - Normal regime: 22 % (UU HPP). Pasal 31E: with turnover ≤ Rp 50 M, the part of PKP from turnover up to Rp 4,8 M (PKP × 4,8 M ÷
 *   turnover; all of it when turnover ≤ 4,8 M) is taxed at half the rate (11 %), the rest at 22 %; each part rounded down to Rupiah.
 * - PP 55/2022 final: 0,5 % of turnover (the accountant chooses it; eligibility isn't judged here).
 */
export const CORPORATE_RATE_PERCENT = 22n;
export const FACILITY_TURNOVER = 4_800_000_000n;
export const FACILITY_LIMIT = 50_000_000_000n;
/** 0,5 % as per mille (5 ‰). */
export const FINAL_UMKM_PERMILLE = 5n;

export function roundDownThousands(v: bigint): bigint {
  return v <= 0n ? 0n : (v / 1000n) * 1000n;
}

export type CorporateTax = {
  regime: TaxRegime;
  pkp: bigint;
  turnover: bigint;
  /** Pasal 31E: PKP taxed at 11 %, and its tax. */
  facilityPkp: bigint;
  facilityTax: bigint;
  /** PKP taxed at 22 %, and its tax. */
  regularPkp: bigint;
  regularTax: bigint;
  /** PPh terutang (normal) or PPh final (0,5 % of turnover). */
  due: bigint;
};

export function corporateTax(input: { regime: TaxRegime; pkp: bigint; turnover: bigint }): CorporateTax {
  const { regime, turnover } = input;
  const base = { regime, turnover, facilityPkp: 0n, facilityTax: 0n, regularPkp: 0n, regularTax: 0n };
  if (regime === "FINAL_UMKM") return { ...base, pkp: 0n, due: turnover > 0n ? (turnover * FINAL_UMKM_PERMILLE) / 1000n : 0n };
  const pkp = input.pkp < 0n ? 0n : input.pkp;
  const facilityPkp = turnover > 0n && turnover <= FACILITY_LIMIT ? (turnover <= FACILITY_TURNOVER ? pkp : (pkp * FACILITY_TURNOVER) / turnover) : 0n;
  const regularPkp = pkp - facilityPkp;
  const facilityTax = (facilityPkp * CORPORATE_RATE_PERCENT) / 200n;
  const regularTax = (regularPkp * CORPORATE_RATE_PERCENT) / 100n;
  return { ...base, pkp, facilityPkp, facilityTax, regularPkp, regularTax, due: facilityTax + regularTax };
}

export type Settlement = {
  credits: bigint;
  /** Positive = PPh 29 kurang bayar; negative = PPh 28A lebih bayar. */
  balance: bigint;
  /** Pasal 25 for next year: (terutang − PPh 22/23/24) ÷ 12, rounded down; never negative. */
  nextInstalment: bigint;
};

export function settlement(input: { due: bigint; instalments: bigint; withheld: bigint; other?: bigint }): Settlement {
  const credits = input.instalments + input.withheld + (input.other ?? 0n);
  const base = input.due - input.withheld;
  return { credits, balance: input.due - credits, nextInstalment: base > 0n ? base / 12n : 0n };
}

/** Deferred tax on a temporary difference (fiscal − book value): positive = asset. 22 %, rounded toward zero. */
export function deferredTax(temporaryDifference: bigint): bigint {
  return (temporaryDifference * CORPORATE_RATE_PERCENT) / 100n;
}
