import { describe, expect, it } from "vitest";
import { pickWorkingMonth } from "@/lib/periods";

describe("working month", () => {
  const now = new Date(Date.UTC(2026, 9, 8)); // 8 Oct 2026
  it("never opens on a month still ahead", () => {
    expect(pickWorkingMonth([{ year: 2027, month: 1 }, { year: 2026, month: 12 }, { year: 2026, month: 9 }], now)).toEqual({ year: 2026, month: 9 });
    expect(pickWorkingMonth([{ year: 2026, month: 10 }, { year: 2026, month: 6 }], now)).toEqual({ year: 2026, month: 10 });
  });
  it("uses the earliest future month only when nothing is due, and today without data", () => {
    expect(pickWorkingMonth([{ year: 2027, month: 1 }], now)).toEqual({ year: 2027, month: 1 });
    expect(pickWorkingMonth([], now)).toEqual({ year: 2026, month: 10 });
  });
});
