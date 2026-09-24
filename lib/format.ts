export { formatRupiah, formatRupiahCompact } from "@/lib/money";

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** Date-only values are stored as UTC midnight; always read with UTC getters. */
export function formatDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatPeriod(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`;
}

export function formatMonthShort(year: number, month: number): string {
  return `${MONTHS_SHORT[month - 1]} ${String(year).slice(2)}`;
}

export const monthName = (m: number) => MONTHS[m - 1];

export function dateOnly(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

export function periodBounds(year: number, month: number) {
  return { start: dateOnly(year, month, 1), end: new Date(Date.UTC(year, month, 0)) };
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
