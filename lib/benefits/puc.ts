import type { Sex } from "@/lib/generated/prisma/enums";

/**
 * PSAK 24 valuation of the PP 35/2021 post-employment benefit with the Projected Unit Credit method (accounting-rules 5g). Rates, ages,
 * probabilities and the per-employee factor are dimensionless numbers (float); money is only ever wage (bigint) × factor rounded to 10⁻⁹,
 * half up. Year by year to retirement: death and disability pay 2 × pesangon + 1 × UPMK (Pasal 55, 57), retirement 1,75 × pesangon +
 * 1 × UPMK (Pasal 56), resignation nothing modelled; decrements mid-year, retirement at the exact age. Attribution (DSAK IAI, April 2022):
 * each benefit is earned over the last 24 years of service before it is paid (the service that earns the capped months), or from hire.
 */

/** Pesangon months for completed years of service (Pasal 40 ayat 2). */
export const pesangonMonths = (years: number) => Math.min(9, Math.floor(years) + 1);

/** Uang penghargaan masa kerja months (Pasal 40 ayat 3). */
export function upmkMonths(years: number) {
  const bands: [number, number][] = [[24, 10], [21, 8], [18, 7], [15, 6], [12, 5], [9, 4], [6, 3], [3, 2]];
  return bands.find(([from]) => years >= from)?.[1] ?? 0;
}

export const retirementMonths = (years: number) => 1.75 * pesangonMonths(years) + upmkMonths(years);
export const deathMonths = (years: number) => 2 * pesangonMonths(years) + upmkMonths(years);

/** Service after which the benefit stops growing (UPMK 10 months at 24 years). */
export const CAP_YEARS = 24;

export type Assumptions = {
  /** Annual rates as fractions (0,07 = 7 %). */
  discount: number;
  salary: number;
  retirementAge: number;
  /** Disability as a fraction of mortality. */
  disability: number;
  /** Resignation rate a year up to `resignFlatUntil`, falling linearly to 0 at `resignZeroAge`. */
  resign: number;
  resignFlatUntil: number;
  resignZeroAge: number;
  /** qx by integer age and sex. */
  qx: (age: number, sex: Sex) => number;
};

export function resignRate(a: Pick<Assumptions, "resign" | "resignFlatUntil" | "resignZeroAge">, age: number) {
  if (age <= a.resignFlatUntil) return a.resign;
  if (age >= a.resignZeroAge) return 0;
  return (a.resign * (a.resignZeroAge - age)) / (a.resignZeroAge - a.resignFlatUntil);
}

/** Share of a benefit paid at `exit` (years from the valuation date) earned by `at`, service having started `service` years ago. */
function earned(service: number, exit: number, at: number) {
  const start = Math.max(-service, exit - CAP_YEARS);
  if (exit - start <= 0) return 1;
  return Math.min(1, Math.max(0, (Math.min(at, exit) - start) / (exit - start)));
}

export type Factors = { dbo: number; serviceCost: number; yearsToRetirement: number; retirementMonths: number; salaryAtRetirement: number };

/** The obligation and next year's service cost per unit of monthly wage, for an employee of exact age and service (years). */
export function factors(p: { age: number; service: number; sex: Sex }, a: Assumptions): Factors {
  const n = a.retirementAge - p.age;
  if (n <= 0) {
    // Past the retirement age: the retirement benefit is due now, fully earned.
    return { dbo: retirementMonths(p.service), serviceCost: 0, yearsToRetirement: 0, retirementMonths: retirementMonths(p.service), salaryAtRetirement: 1 };
  }
  const v = (t: number) => (1 + a.discount) ** -t;
  const grow = (t: number) => (1 + a.salary) ** t;
  let alive = 1;
  let dbo = 0;
  let next = 0;
  for (let t = 0; t < n; t++) {
    const span = Math.min(1, n - t);
    const age = Math.floor(p.age + t);
    const q = Math.min(1, a.qx(age, p.sex) * span);
    const exits = q * (1 + a.disability);
    const w = resignRate(a, p.age + t) * span;
    const mid = t + span / 2;
    const value = alive * exits * deathMonths(p.service + mid) * grow(mid) * v(mid);
    dbo += value * earned(p.service, mid, 0);
    next += value * earned(p.service, mid, 1);
    alive *= Math.max(0, 1 - exits - w);
  }
  const retire = alive * retirementMonths(p.service + n) * grow(n) * v(n);
  dbo += retire * earned(p.service, n, 0);
  next += retire * earned(p.service, n, 1);
  return { dbo, serviceCost: next - dbo, yearsToRetirement: n, retirementMonths: retirementMonths(p.service + n), salaryAtRetirement: grow(n) };
}

const SCALE = 1_000_000_000;
/** wage × factor, the factor to 10⁻⁹, half up (amounts ≥ 0). */
export function times(wage: bigint, factor: number): bigint {
  const f = BigInt(Math.round(factor * SCALE));
  return (wage * f * 2n + BigInt(SCALE)) / (2n * BigInt(SCALE));
}

const YEAR_MS = 365.25 * 86_400_000;
export const yearsBetween = (from: Date, to: Date) => (+to - +from) / YEAR_MS;

export type EmployeeValue = { age: number; service: number; yearsToRetirement: number; benefitAtRetirement: bigint; dbo: bigint; serviceCost: bigint };

export function valueEmployee(e: { birthDate: Date; hireDate: Date; sex: Sex; wage: bigint }, a: Assumptions, at: Date): EmployeeValue {
  const age = yearsBetween(e.birthDate, at);
  const service = yearsBetween(e.hireDate, at);
  const f = factors({ age, service, sex: e.sex }, a);
  return { age, service, yearsToRetirement: f.yearsToRetirement, benefitAtRetirement: times(e.wage, f.retirementMonths * f.salaryAtRetirement), dbo: times(e.wage, f.dbo), serviceCost: times(e.wage, f.serviceCost) };
}

/** Interest cost for the next year: discount × (DBO + service cost), half up. */
export const interestCost = (dbo: bigint, serviceCost: bigint, discountBp: number) => ((dbo + serviceCost) * BigInt(discountBp) * 2n + 10_000n) / 20_000n;
