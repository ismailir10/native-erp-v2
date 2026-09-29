import type { LeaseTiming } from "@/lib/generated/prisma/enums";
import { periodBounds } from "@/lib/format";

/**
 * The lease schedule (PSAK 116, accounting-rules 5f), computed from the contract and never stored. Monthly rate = annual ÷ 12 as an exact
 * fraction (rateBp / 120 000). The liability at every month-end is the exact present value of the payments still due, rounded half up
 * once, and the month's interest is the difference (closing − opening + payment) — so rounding never compounds and the liability ends at
 * exactly 0. The ROU asset (= initial liability) is depreciated straight line. Amounts are bigint minor units of the entity's currency.
 */

export type LeaseTerms = { startYear: number; startMonth: number; months: number; payment: bigint; intervalMonths: number; timing: LeaseTiming; rateBp: number };

export type LeaseMonth = {
  /** 1 … months. */
  k: number;
  year: number;
  month: number;
  /** Month-end. */
  date: Date;
  opening: bigint;
  payment: bigint;
  interest: bigint;
  closing: bigint;
  depreciation: bigint;
  accumulated: bigint;
  /** Liability due after 12 more months (non-current) and the rest (current), at the month-end. */
  nonCurrent: bigint;
  current: bigint;
  /** Fiscal rent of the month: the total payments straight line over the term. */
  fiscalRent: bigint;
};

export type LeaseSchedule = { liability: bigint; rou: bigint; totalPayments: bigint; current: bigint; nonCurrent: bigint; months: LeaseMonth[] };

const RATE_DEN = 120_000n;
const halfUp = (num: bigint, den: bigint) => (num >= 0n ? (num * 2n + den) / (2n * den) : -((-num * 2n + den) / (2n * den)));

export const paymentsCount = (t: Pick<LeaseTerms, "months" | "intervalMonths">) => t.months / t.intervalMonths;

/** Months (from commencement) at which each payment is made: advance at the start of its interval, arrears at the end. */
export function paymentTimes(t: Pick<LeaseTerms, "months" | "intervalMonths" | "timing">): number[] {
  return Array.from({ length: paymentsCount(t) }, (_, j) => (t.timing === "ADVANCE" ? j * t.intervalMonths : (j + 1) * t.intervalMonths));
}

/** Σ P ÷ (1 + r)^t as an exact fraction numerator / denominator. */
function exactValue(t: Pick<LeaseTerms, "months" | "intervalMonths" | "timing" | "payment" | "rateBp">) {
  const num = RATE_DEN + BigInt(t.rateBp);
  const times = paymentTimes(t);
  const T = Math.max(...times);
  return { numerator: times.reduce((s, x) => s + RATE_DEN ** BigInt(x) * num ** BigInt(T - x), 0n) * t.payment, denominator: num ** BigInt(T) };
}

/** Σ P ÷ (1 + r)^t exactly, rounded half up once. */
export function presentValue(t: Pick<LeaseTerms, "months" | "intervalMonths" | "timing" | "payment" | "rateBp">): bigint {
  const v = exactValue(t);
  return halfUp(v.numerator, v.denominator);
}

/**
 * Monthly roll on the exact liability N / D (advance payment at the start of the month, growth at the monthly rate, arrears payment at the
 * end); each month-end is that exact value rounded once, and interest is derived from the rounded balances.
 */
function roll(t: LeaseTerms, liability: bigint) {
  const num = RATE_DEN + BigInt(t.rateBp);
  let { numerator: N, denominator: D } = exactValue(t);
  let previous = liability;
  const rows: { opening: bigint; payment: bigint; interest: bigint; closing: bigint }[] = [];
  for (let k = 1; k <= t.months; k++) {
    const advance = t.timing === "ADVANCE" && (k - 1) % t.intervalMonths === 0;
    const arrears = t.timing === "ARREARS" && k % t.intervalMonths === 0;
    if (advance) N -= t.payment * D;
    N *= num;
    D *= RATE_DEN;
    if (arrears) N -= t.payment * D;
    const payment = advance || arrears ? t.payment : 0n;
    const closing = halfUp(N, D);
    rows.push({ opening: previous, payment, interest: closing - previous + payment, closing });
    previous = closing;
  }
  return rows;
}

export function leaseSchedule(t: LeaseTerms): LeaseSchedule {
  const liability = presentValue(t);
  const rows = roll(t, liability);
  const rou = liability;
  const n = BigInt(t.months);
  const dep = rou / n;
  const totalPayments = t.payment * BigInt(paymentsCount(t));
  const rent = totalPayments / n;
  const after = (k: number) => (k <= 0 ? liability : k > t.months ? 0n : rows[k - 1].closing);
  let accumulated = 0n;
  const months: LeaseMonth[] = rows.map((r, i) => {
    const k = i + 1;
    const idx = t.startYear * 12 + (t.startMonth - 1) + i;
    const [year, month] = [Math.floor(idx / 12), (idx % 12) + 1];
    const depreciation = k === t.months ? rou - dep * (n - 1n) : dep;
    accumulated += depreciation;
    const nonCurrent = after(k + 12);
    return { k, year, month, date: periodBounds(year, month).end, ...r, depreciation, accumulated, nonCurrent, current: r.closing - nonCurrent, fiscalRent: k === t.months ? totalPayments - rent * (n - 1n) : rent };
  });
  return { liability, rou, totalPayments, current: liability - after(12), nonCurrent: after(12), months };
}

/** How many months of the term have ended by the end of year-month (0 before the start, capped at the term). */
export function monthsElapsed(t: Pick<LeaseTerms, "startYear" | "startMonth" | "months">, year: number, month: number) {
  const n = year * 12 + month - (t.startYear * 12 + t.startMonth) + 1;
  return Math.max(0, Math.min(t.months, n));
}

/** The register position at the end of year-month: carrying amounts and year-to-date P&L / fiscal figures. */
export function positionAt(t: LeaseTerms, s: LeaseSchedule, year: number, month: number) {
  const k = monthsElapsed(t, year, month);
  const started = year * 12 + month >= t.startYear * 12 + t.startMonth;
  const upTo = s.months.slice(0, k);
  const inYear = upTo.filter((m) => m.year === year);
  const sum = (xs: LeaseMonth[], f: (m: LeaseMonth) => bigint) => xs.reduce((a, m) => a + f(m), 0n);
  const row = k ? s.months[k - 1] : null;
  return {
    k,
    started,
    rou: started ? s.rou : 0n,
    accumulated: row?.accumulated ?? 0n,
    liability: row ? row.closing : started ? s.liability : 0n,
    current: row ? row.current : started ? s.current : 0n,
    nonCurrent: row ? row.nonCurrent : started ? s.nonCurrent : 0n,
    paidToDate: sum(upTo, (m) => m.payment),
    fiscalToDate: sum(upTo, (m) => m.fiscalRent),
    year: { depreciation: sum(inYear, (m) => m.depreciation), interest: sum(inYear, (m) => m.interest), fiscalRent: sum(inYear, (m) => m.fiscalRent), payments: sum(inYear, (m) => m.payment) },
  };
}
