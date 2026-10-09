import { describe, expect, it } from "vitest";
import { deathMonths, factors, interestCost, pesangonMonths, resignRate, retirementMonths, times, upmkMonths, valueEmployee, type Assumptions } from "@/lib/benefits/puc";
import { dateOnly } from "@/lib/format";

const none: Assumptions = { discount: 0, salary: 0, retirementAge: 56, disability: 0, resign: 0, resignFlatUntil: 30, resignZeroAge: 55, qx: () => 0 };
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-12);

describe("PP 35/2021 benefit months", () => {
  it("pesangon, UPMK and the retirement / death multiples", () => {
    expect([0, 0.5, 1, 7.99, 8, 30].map(pesangonMonths)).toEqual([1, 1, 2, 8, 9, 9]);
    expect([2.99, 3, 6, 9, 12, 15, 18, 21, 23.9, 24, 40].map(upmkMonths)).toEqual([0, 2, 3, 4, 5, 6, 7, 8, 8, 10, 10]);
    expect(retirementMonths(20)).toBe(1.75 * 9 + 7);
    expect(deathMonths(20)).toBe(2 * 9 + 7);
    expect(retirementMonths(24)).toBe(25.75);
  });
});

describe("PUC factors (PSAK 219)", () => {
  it("without decrements or discounting: the retirement benefit × the share of service earned", () => {
    // 46 years old, 10 years of service, retiring at 56 with 20 years: 22,75 months, half earned; next year earns 1/20 more.
    const f = factors({ age: 46, service: 10, sex: "MALE" }, none);
    close(f.dbo, 22.75 * 0.5);
    close(f.serviceCost, 22.75 / 20);
    expect(times(10_000_000n, f.dbo)).toBe(113_750_000n);
    expect(times(10_000_000n, f.serviceCost)).toBe(11_375_000n);
  });

  it("attributes only the last 24 years before retirement", () => {
    // 26 years old with 5 years of service: retirement is 30 years away, so nothing is earned before age 32.
    const f = factors({ age: 26, service: 5, sex: "FEMALE" }, none);
    expect([f.dbo, f.serviceCost]).toEqual([0, 0]);
    // 33 years old with 12 years: 23 years to go, earned from 1 year ago → 1/24 of 25,75 months.
    close(factors({ age: 33, service: 12, sex: "MALE" }, none).dbo, 25.75 / 24);
  });

  it("discounts and projects the wage", () => {
    const f = factors({ age: 46, service: 10, sex: "MALE" }, { ...none, discount: 0.1, salary: 0.05 });
    close(f.dbo, 22.75 * 0.5 * 1.05 ** 10 * 1.1 ** -10);
  });

  it("one year to retirement with mortality: death mid-year at 2 × pesangon + UPMK, else retirement", () => {
    const a = { ...none, qx: () => 0.01 };
    const f = factors({ age: 55, service: 20, sex: "MALE" }, a);
    close(f.dbo, 0.01 * 25 * (20 / 20.5) + 0.99 * 23.75 * (20 / 21));
    // Disability as 10 % of mortality adds to the exits; resignation at 55 is 0.
    const g = factors({ age: 55, service: 20, sex: "MALE" }, { ...a, disability: 0.1 });
    close(g.dbo, 0.011 * 25 * (20 / 20.5) + 0.989 * 23.75 * (20 / 21));
  });

  it("values an employee past the retirement age at the immediate benefit", () => {
    expect(factors({ age: 58, service: 30, sex: "FEMALE" }, none)).toMatchObject({ dbo: 25.75, serviceCost: 0 });
  });

  it("resigns less with age, and prices from dates", () => {
    const a = { ...none, resign: 0.05, resignFlatUntil: 30, resignZeroAge: 55 };
    expect([resignRate(a, 25), resignRate(a, 30), resignRate(a, 42.5), resignRate(a, 55)]).toEqual([0.05, 0.05, 0.025, 0]);
    const e = valueEmployee({ birthDate: dateOnly(1980, 12, 31), hireDate: dateOnly(2016, 12, 31), sex: "MALE", wage: 8_000_000n }, none, dateOnly(2026, 12, 31));
    expect(Math.round(e.age)).toBe(46);
    expect(Math.round(e.service)).toBe(10);
    expect(e.benefitAtRetirement).toBe(8_000_000n * 2275n / 100n);
    expect(interestCost(1_000_000n, 100_000n, 700)).toBe(77_000n);
  });
});
