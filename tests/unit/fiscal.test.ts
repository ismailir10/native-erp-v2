import { describe, expect, it } from "vitest";
import { financialYear, fiscalLabel, fiscalSpan, fiscalYearStart, priorYearEnd, samePeriodLastYear } from "@/lib/fiscal";
import { dateOnly } from "@/lib/format";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The client's financial year (tahun buku): twelve months ending in its end month. */
describe("financial year", () => {
  it("is the calendar year for December, exactly as before", () => {
    for (let m = 1; m <= 12; m++) {
      const fy = financialYear(12, 2026, m);
      expect([iso(fy.start), iso(fy.end), fiscalLabel(fy)]).toEqual(["2026-01-01", "2026-12-31", "2026"]);
    }
    expect(iso(priorYearEnd(12, 2026, 8))).toBe("2025-12-31");
    expect(Object.values(samePeriodLastYear(12, 2026, 8)).map(iso)).toEqual(["2025-01-01", "2025-08-31"]);
  });

  it("runs 1 February – 31 January for a January year end (Chickin)", () => {
    expect([iso(financialYear(1, 2026, 8).start), iso(financialYear(1, 2026, 8).end), fiscalLabel(financialYear(1, 2026, 8))]).toEqual(["2026-02-01", "2027-01-31", "2026/2027"]);
    // January 2026 closes the year that began in February 2025.
    expect([iso(financialYear(1, 2026, 1).start), iso(financialYear(1, 2026, 1).end)]).toEqual(["2025-02-01", "2026-01-31"]);
    expect(iso(financialYear(1, 2026, 2).start)).toBe("2026-02-01");
    expect(iso(priorYearEnd(1, 2026, 8))).toBe("2026-01-31");
    expect(Object.values(samePeriodLastYear(1, 2026, 8)).map(iso)).toEqual(["2025-02-01", "2025-08-31"]);
    expect(Object.values(samePeriodLastYear(1, 2027, 1)).map(iso)).toEqual(["2025-02-01", "2026-01-31"]);
    expect(iso(fiscalYearStart(1, dateOnly(2026, 1, 31)))).toBe("2025-02-01");
  });

  it("holds twelve months for every end month, ends on the month's last day (leap February), and the next year starts the day after", () => {
    for (let e = 1; e <= 12; e++) {
      for (let m = 1; m <= 12; m++) {
        const fy = financialYear(e, 2027, m);
        expect(+fy.start <= +dateOnly(2027, m, 1) && +dateOnly(2027, m, 1) <= +fy.end, `end ${e} month ${m}`).toBe(true);
        expect(fy.end.getUTCMonth() + 1).toBe(e);
        const after = new Date(+fy.end + 86_400_000);
        expect(+financialYear(e, after.getUTCFullYear(), after.getUTCMonth() + 1).start).toBe(+after);
      }
    }
    expect(iso(financialYear(2, 2028, 2).end)).toBe("2028-02-29");
    expect(iso(financialYear(6, 2026, 6).start)).toBe("2025-07-01");
  });

  it("names the months in Bahasa", () => {
    expect([fiscalSpan(12), fiscalSpan(1), fiscalSpan(2), fiscalSpan(6)]).toEqual(["1 Januari – 31 Desember", "1 Februari – 31 Januari", "1 Maret – akhir Februari", "1 Juli – 30 Juni"]);
  });
});
