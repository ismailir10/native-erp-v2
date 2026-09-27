import type { Direction } from "@/lib/generated/prisma/enums";
import type { Classification } from "@/lib/classify/types";

/**
 * Financing text (accounting-rules 13, 22a): loans, capital and own-money moves are balance-sheet movements, not Laba Rugi.
 * The sanity control flags P&L lines with these words; the classifier uses the same words to suggest the balance-sheet
 * account in the first place (after rules and memory, before AI — no paid call for them). Always a HEURISTIC: it goes to
 * review and never auto-posts (rule 14).
 */

/** Words that mark financing or own-money movements — balance-sheet, not Laba Rugi. */
export const FINANCING = /\b(PINJAMAN|LOAN|PRK|PLAFON|ANGSURAN|POKOK|PENCAIRAN (?:KREDIT|KMK|KI)|PELUNASAN (?:KREDIT|KMK|KI)|SETORAN MODAL|MODAL|DEPOSITO|PENEMPATAN|PINDAH ?BUKU|OVERBOOK\w*|ANTAR REKENING)\b/i;
/** Interest, fees and taxes on those movements are legitimately P&L. */
export const FINANCING_COST = /\b(BUNGA|INTEREST|BIAYA|FEE|ADM\w*|PAJAK|TAX|MATERAI|STAMP|PROVISI)\b/i;

const INTEREST = /\b(BUNGA|INTEREST)\b/i;
const FEES = /\b(BIAYA|FEE|ADM\w*|MATERAI|STAMP|PROVISI)\b/i;
const CAPITAL = /\b(SETORAN MODAL|MODAL)\b/i;
// PENCAIRAN / PELUNASAN alone also mean a deposit or an invoice being settled: they count only with a loan word next to them.
const LOAN_IN = /\b(PINJAMAN|LOAN|PLAFON|PRK|PENCAIRAN (?:KREDIT|KMK|KI))\b/i;
const LOAN_OUT = /\b(ANGSURAN|POKOK|PINJAMAN|LOAN|PELUNASAN (?:KREDIT|KMK|KI))\b/i;
const OWN_MOVE = /\b(PINDAH ?BUKU|OVERBOOK\w*|ANTAR REKENING)\b/i;

export const FINANCING_CONFIDENCE = 0.5;

/** The balance-sheet (or financing-cost) account a financing line most likely belongs to, or null. */
export function financingSuggestion(description: string, direction: Direction): Classification | null {
  if (!FINANCING.test(description)) return null;
  const guess = (accountCode: string, reason: string): Classification => ({ method: "HEURISTIC", accountCode, taxTag: null, confidence: FINANCING_CONFIDENCE, reason });
  if (INTEREST.test(description)) return direction === "OUT" ? guess("7110", "Bunga pinjaman: beban bunga, bukan pokok") : null;
  if (FEES.test(description)) return direction === "OUT" ? guess("7100", "Biaya atas pinjaman/rekening: beban administrasi bank") : null;
  // Loan markers win over a bare MODAL ("PENCAIRAN PINJAMAN MODAL KERJA" is working-capital debt, not equity).
  if (direction === "IN" && LOAN_IN.test(description)) return guess("2210", "Pencairan pinjaman: utang bank, bukan penjualan");
  if (direction === "IN" && CAPITAL.test(description)) return guess("3100", "Setoran modal: ekuitas, bukan penjualan");
  if (direction === "OUT" && LOAN_OUT.test(description)) return guess("2210", "Angsuran pokok pinjaman: mengurangi utang bank, bukan beban");
  if (OWN_MOVE.test(description)) return guess("1199", "Pindah dana antar rekening sendiri: kliring sampai pasangannya diimpor");
  return null;
}
