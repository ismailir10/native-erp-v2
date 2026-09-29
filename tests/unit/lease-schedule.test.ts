import { describe, expect, it } from "vitest";
import { leaseSchedule, monthsElapsed, paymentTimes, positionAt, presentValue, type LeaseTerms } from "@/lib/leases/schedule";

const monthly: LeaseTerms = { startYear: 2026, startMonth: 1, months: 24, payment: 10_000_000n, intervalMonths: 1, timing: "ARREARS", rateBp: 1_200 };
const quarterly: LeaseTerms = { startYear: 2026, startMonth: 3, months: 36, payment: 30_000_000n, intervalMonths: 3, timing: "ADVANCE", rateBp: 1_000 };

describe("lease schedule (PSAK 116)", () => {
  it("takes the exact present value of the payments", () => {
    // 10 jt × annuity factor 21,24338726 at 1 % a month, 24 months in arrears.
    expect(presentValue(monthly)).toBe(212_433_873n);
    expect(presentValue({ ...monthly, timing: "ADVANCE" })).toBe(214_558_211n);
    expect(presentValue(quarterly)).toBe(315_091_850n);
    expect(presentValue({ ...quarterly, months: 36, intervalMonths: 12, payment: 120_000_000n, rateBp: 900 })).toBe(330_008_347n);
    expect(presentValue({ ...monthly, payment: 5_000_000n, rateBp: 0 })).toBe(120_000_000n);
    expect(paymentTimes(quarterly)).toEqual([0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33]);
  });

  it("amortises the liability to zero from exact month-end values, rounded once each", () => {
    const s = leaseSchedule(monthly);
    expect(s.months[0]).toMatchObject({ k: 1, year: 2026, month: 1, opening: 212_433_873n, payment: 10_000_000n, interest: 2_124_338n, closing: 204_558_211n });
    expect(s.months[23]).toMatchObject({ k: 24, year: 2027, month: 12, interest: 99_010n, closing: 0n });
    expect(s.months.reduce((t, m) => t + m.interest, 0n)).toBe(240_000_000n - 212_433_873n);
    // Current portion at commencement = liability − liability after 12 months.
    expect([s.current, s.nonCurrent]).toEqual([212_433_873n - 112_550_775n, 112_550_775n]);
    expect(s.months[0]).toMatchObject({ nonCurrent: 103_676_282n, current: 204_558_211n - 103_676_282n });
    expect(s.months[12]).toMatchObject({ nonCurrent: 0n });

    const q = leaseSchedule(quarterly);
    expect(q.months[0]).toMatchObject({ year: 2026, month: 3, payment: 30_000_000n, interest: 2_375_765n, closing: 287_467_615n });
    expect(q.months[33]).toMatchObject({ payment: 30_000_000n, interest: 0n, closing: 0n }); // last payment clears it exactly
    expect(q.months[35]).toMatchObject({ year: 2029, month: 2, interest: 0n, closing: 0n });
    expect(q.months.reduce((t, m) => t + m.interest, 0n)).toBe(360_000_000n - 315_091_850n);
  });

  it("clears the liability exactly even when rounding compounds (20 years, annual in advance, 100 %)", () => {
    const t: LeaseTerms = { startYear: 2026, startMonth: 1, months: 240, payment: 10_000_000n, intervalMonths: 12, timing: "ADVANCE", rateBp: 10_000 };
    const s = leaseSchedule(t);
    expect(s.months[239].closing).toBe(0n);
    expect(s.months.every((m) => m.closing >= 0n)).toBe(true);
    expect(s.months.reduce((a, m) => a + m.interest, 0n)).toBe(200_000_000n - s.liability);
    expect(s.months[228 + 1].interest).toBe(0n); // after the last payment nothing accrues
  });

  it("depreciates the ROU straight line and spreads fiscal rent over the term", () => {
    const s = leaseSchedule(monthly);
    expect(s.rou).toBe(212_433_873n);
    expect(s.months[0].depreciation).toBe(8_851_411n);
    expect(s.months[23]).toMatchObject({ depreciation: 212_433_873n - 8_851_411n * 23n, accumulated: 212_433_873n });
    expect(s.months.every((m) => m.fiscalRent === 10_000_000n)).toBe(true);
    const q = leaseSchedule(quarterly);
    expect(q.months[0].fiscalRent).toBe(10_000_000n);
  });

  it("reads the position at a month-end", () => {
    const s = leaseSchedule(quarterly);
    expect(monthsElapsed(quarterly, 2026, 2)).toBe(0);
    expect(monthsElapsed(quarterly, 2026, 12)).toBe(10);
    expect(monthsElapsed(quarterly, 2030, 1)).toBe(36);
    expect(positionAt(quarterly, s, 2026, 2)).toMatchObject({ k: 0, started: false, rou: 0n, liability: 0n, paidToDate: 0n });
    const dec = positionAt(quarterly, s, 2026, 12);
    // Mar–Dec 2026: 4 payments (Mar, Jun, Sep, Dec), 10 months of fiscal rent and depreciation.
    expect(dec).toMatchObject({ k: 10, rou: 315_091_850n, paidToDate: 120_000_000n, fiscalToDate: 100_000_000n, liability: s.months[9].closing });
    expect(dec.year).toMatchObject({ payments: 120_000_000n, fiscalRent: 100_000_000n, depreciation: s.months.slice(0, 10).reduce((t, m) => t + m.depreciation, 0n) });
    const next = positionAt(quarterly, s, 2027, 6);
    expect(next.year.fiscalRent).toBe(60_000_000n); // Jan–Jun 2027 only
  });
});
