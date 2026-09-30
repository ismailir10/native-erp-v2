import type { Direction, EntityKind } from "@/lib/generated/prisma/enums";
import type { Classification } from "@/lib/classify/types";
import { financingSuggestion, taxPaymentSuggestion } from "@/lib/classify/financing";

/**
 * The simple guess when nothing else suggests an account (last in rule 13's order): low confidence, always to review.
 * A company's money in is most often a sale and money out an expense. A person's own books aren't a business: money in is
 * other income until its source is known (from the PT, a loan, a salary), money out is the owner's own use (Prive).
 */
export function simpleGuess(direction: Direction, kind: EntityKind): Classification {
  const guess = (accountCode: string, reason: string): Classification => ({ method: "HEURISTIC", accountCode, taxTag: null, confidence: 0.3, reason });
  if (kind === "PERORANGAN") {
    return direction === "IN"
      ? guess("4910", "Tebakan sederhana: uang masuk pribadi — pastikan sumbernya (dari PT, pinjaman, atau penghasilan)")
      : guess("3300", "Tebakan sederhana: uang keluar pribadi dianggap pemakaian pemilik (Prive)");
  }
  return direction === "IN"
    ? guess("4100", "Tebakan sederhana: uang masuk dianggap penjualan")
    : guess("6190", "Tebakan sederhana: uang keluar dianggap beban umum");
}

/**
 * A line whose suggestion is only the simple guess above (no rule, memory, AI, financing or tax-payment text behind it). Review never
 * accepts it with Enter alone, and accepting it unchanged teaches Memory nothing (lib/review.ts): "uang keluar dianggap beban umum"
 * learned once would auto-post that counterparty to 6190 on every later import.
 */
export function isSimpleGuess(t: { method: string; description: string; direction: Direction }): boolean {
  return t.method === "HEURISTIC" && !financingSuggestion(t.description, t.direction) && !taxPaymentSuggestion(t.description, t.direction);
}
