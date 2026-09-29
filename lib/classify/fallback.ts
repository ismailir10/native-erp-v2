import type { Direction, EntityKind } from "@/lib/generated/prisma/enums";
import type { Classification } from "@/lib/classify/types";

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
