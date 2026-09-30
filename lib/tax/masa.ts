import { dateOnly } from "@/lib/format";

/**
 * Masa pajak of a PPh 25 instalment (accounting-rules 5d): the month the instalment is for, stored on the bank line as the first day of
 * that month. PPh 25 is paid by the 15th of the following month, so the default is the month before the payment: December's
 * instalment paid on 14 January belongs to the year that ended.
 */
export function defaultTaxMonth(paidOn: Date): Date {
  // dateOnly takes a 1-based month, getUTCMonth is 0-based: this is the previous month, and month 0 wraps to December of the year before.
  return dateOnly(paidOn.getUTCFullYear(), paidOn.getUTCMonth(), 1);
}
