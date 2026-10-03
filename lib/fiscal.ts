import type { Db } from "@/lib/db";
import { dateOnly, monthName } from "@/lib/format";

/**
 * The client's financial year (*tahun buku*, accounting-rules 1): twelve months ending in `endMonth` (12 = the calendar year). Every
 * "year to date", "previous year end" and "same months last year" in Buku reads it, so a client closing on 31 January counts from
 * 1 February. Derived only: nothing is posted at a year end.
 */
export type FinancialYear = { start: Date; end: Date; startYear: number; endYear: number };

const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0));

export const isFiscalEndMonth = (m: unknown): m is number => typeof m === "number" && Number.isInteger(m) && m >= 1 && m <= 12;

/** The financial year holding `month` of `year`. */
export function financialYear(endMonth: number, year: number, month: number): FinancialYear {
  const startMonth = (endMonth % 12) + 1;
  const startYear = month >= startMonth ? year : year - 1;
  const endYear = endMonth === 12 ? startYear : startYear + 1;
  return { start: dateOnly(startYear, startMonth, 1), end: lastDay(endYear, endMonth), startYear, endYear };
}

/** The first day of the financial year holding `date`. */
export const fiscalYearStart = (endMonth: number, date: Date) => financialYear(endMonth, date.getUTCFullYear(), date.getUTCMonth() + 1).start;

/** The last day of the previous financial year (the Neraca's comparative), for the year holding `month` of `year`. */
export const priorYearEnd = (endMonth: number, year: number, month: number) => new Date(+financialYear(endMonth, year, month).start - 86_400_000);

/** The same months of the previous financial year: its start through `month` of `year - 1`. */
export function samePeriodLastYear(endMonth: number, year: number, month: number): { start: Date; end: Date } {
  return { start: financialYear(endMonth, year - 1, month).start, end: lastDay(year - 1, month) };
}

/** "2026" for a calendar year, "2026/2027" for one that spans two. */
export const fiscalLabel = (fy: FinancialYear) => (fy.startYear === fy.endYear ? String(fy.startYear) : `${fy.startYear}/${fy.endYear}`);

/** "1 Januari – 31 Desember", "1 Februari – 31 Januari", "1 Maret – akhir Februari": the year's months, for the settings. */
export const fiscalSpan = (endMonth: number) => {
  const startMonth = (endMonth % 12) + 1;
  return `1 ${monthName(startMonth)} – ${endMonth === 2 ? "akhir" : lastDay(2001, endMonth).getUTCDate()} ${monthName(endMonth)}`;
};

/** The client's year-end month (12 when none is set). */
export async function fiscalEndMonth(db: Db, clientId: string): Promise<number> {
  const c = await db.client.findUnique({ where: { id: clientId }, select: { fiscalYearEndMonth: true } });
  return c?.fiscalYearEndMonth ?? 12;
}
