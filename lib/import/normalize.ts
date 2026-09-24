import { createHash } from "node:crypto";
import type { ParsedRow, ParsedStatement } from "@/lib/import/types";

/**
 * Merchant key: the stable part of a bank description, used for rules, memory and the
 * AI cache. "TRSF E-BANKING DB 0108/FTSCY/WS95051 15000000.00 PT PAKAN JAYA" → "PT PAKAN JAYA".
 * Deterministic and cheap; the AI cache is keyed on this, so better keys = fewer paid calls.
 */
const NOISE = [
  /\bTRSF\b|\bTRF\b|\bTRANSFER\b|\bE-BANKING\b|\bEBANKING\b|\bM-BANKING\b|\bMB\b|\bIB\b/g,
  /\bDB\b|\bCR\b|\bKR\b|\bDR\b/g,
  /\bBI-?FAST\b|\bRTGS\b|\bSKN\b|\bLLG\b|\bSWITCHING\b|\bKE\b|\bDARI\b|\bFROM\b|\bTO\b|\bKLIRING\b/g,
  /\b\d{2,4}\/[A-Z0-9]+\/[A-Z0-9]+\b/g, // 0108/FTSCY/WS95051
  /\b[A-Z]{0,4}\d[A-Z0-9]{5,}\b/g, // reference numbers
  /\b\d+([.,]\d+)*\b/g, // amounts, dates, account numbers
  /[^A-Z &]/g,
];

export function merchantKey(description: string): string {
  let s = ` ${description.toUpperCase()} `;
  for (const re of NOISE) s = s.replace(re, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s || description.toUpperCase().slice(0, 40).trim();
}

export function rowHash(row: ParsedRow): string {
  return createHash("sha1")
    .update([row.date.toISOString().slice(0, 10), row.amount.toString(), row.description, row.balance?.toString() ?? ""].join("|"))
    .digest("hex")
    .slice(0, 24);
}

export type ContinuityResult = { ok: boolean; note: string | null; brokenRows: number[] };

/**
 * Running-balance continuity: opening + Σ amounts must walk through every printed balance
 * and land on the closing balance. A break means missing/duplicated rows in the file.
 */
export function checkContinuity(st: ParsedStatement): ContinuityResult {
  let running = st.openingBalance;
  const broken: number[] = [];
  for (const r of st.rows) {
    running += r.amount;
    if (r.balance !== null && r.balance !== running) {
      broken.push(r.rowNumber);
      running = r.balance;
    }
  }
  const endOk = running === st.closingBalance;
  if (broken.length === 0 && endOk) return { ok: true, note: null, brokenRows: [] };
  const parts: string[] = [];
  if (broken.length) parts.push(`Saldo berjalan tidak nyambung di baris ${broken.slice(0, 5).join(", ")}${broken.length > 5 ? "…" : ""}`);
  if (!endOk) parts.push("Saldo akhir tidak sama dengan saldo awal + mutasi");
  return { ok: false, note: parts.join(". "), brokenRows: broken };
}
