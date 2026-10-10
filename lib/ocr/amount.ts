import { parseBankAmount } from "@/lib/import/parsers/common";
import { parseMoney } from "@/lib/money";

/**
 * A printed amount as whole Rupiah, or null when empty or unreadable. Statements print Indonesian ("1.250.000,00") or English
 * ("1,250,000.00") grouping, sometimes with a CR/DB marker; nothing is guessed beyond that (rule 6).
 */
export function readAmount(text: string | null | undefined): bigint | null {
  let t = (text ?? "").trim().replace(/\s*(CR|DB|K|D)$/i, "").replace(/\s/g, "");
  if (!t) return null;
  // Validate the source grammar before normalising separators; keep parseMoney below so OCR never rounds sen.
  try { parseBankAmount(t); } catch { return null; }
  // English grouping: commas in threes, an optional dot fraction → Indonesian notation.
  const en = t.match(/^([-(]?(?:Rp\.?)?)(\d{1,3}(?:,\d{3})+)(?:\.(\d+))?(\)?)$/i);
  if (en) t = `${en[1]}${en[2].replace(/,/g, ".")}${en[3] ? `,${en[3]}` : ""}${en[4]}`;
  else if (/^\d+\.\d{2}$/.test(t)) t = t.replace(".", ",");
  try {
    return parseMoney(t, "IDR");
  } catch {
    return null;
  }
}
