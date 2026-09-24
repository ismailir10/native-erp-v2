import type { Direction, TaxTag } from "@/lib/generated/prisma/enums";
import type { Classification } from "@/lib/classify/types";

export type RuleLike = {
  id?: string;
  pattern: string;
  direction: Direction | null;
  accountCode: string;
  taxTag: TaxTag | null;
  priority: number;
  clientId?: string | null;
};

/** Client rules beat firm rules; then lower priority number wins; then longer pattern. */
export function sortRules<T extends RuleLike>(rules: T[]): T[] {
  return [...rules].sort(
    (a, b) =>
      Number(Boolean(b.clientId)) - Number(Boolean(a.clientId)) ||
      a.priority - b.priority ||
      b.pattern.length - a.pattern.length,
  );
}

export function matchRule(rules: RuleLike[], description: string, direction: Direction): Classification | null {
  const text = description.toUpperCase();
  for (const r of rules) {
    if (r.direction && r.direction !== direction) continue;
    if (!text.includes(r.pattern.toUpperCase())) continue;
    return {
      method: "RULE",
      accountCode: r.accountCode,
      taxTag: r.taxTag,
      confidence: 0.97,
      reason: `Aturan: keterangan mengandung "${r.pattern}"`,
    };
  }
  return null;
}

/** Firm-wide starter rules for common Indonesian bank descriptors. */
export const FIRM_RULES: Omit<RuleLike, "clientId">[] = [
  { pattern: "PAJAK BUNGA", direction: "OUT", accountCode: "8200", taxTag: "PPH_4_2", priority: 10 },
  { pattern: "PAJAK JASA GIRO", direction: "OUT", accountCode: "8200", taxTag: "PPH_4_2", priority: 10 },
  { pattern: "BUNGA", direction: "IN", accountCode: "4900", taxTag: null, priority: 20 },
  { pattern: "JASA GIRO", direction: "IN", accountCode: "4900", taxTag: null, priority: 20 },
  { pattern: "BIAYA ADM", direction: "OUT", accountCode: "7100", taxTag: null, priority: 20 },
  { pattern: "BIAYA TRANSFER", direction: "OUT", accountCode: "7100", taxTag: null, priority: 20 },
  { pattern: "BIAYA TRX", direction: "OUT", accountCode: "7100", taxTag: null, priority: 20 },
  { pattern: "ADM BULANAN", direction: "OUT", accountCode: "7100", taxTag: null, priority: 20 },
  { pattern: "SETORAN PPN", direction: "OUT", accountCode: "2130", taxTag: "PPN_KELUARAN", priority: 15 },
  { pattern: "PPH 21", direction: "OUT", accountCode: "6100", taxTag: "PPH_21", priority: 15 },
  { pattern: "PPH 25", direction: "OUT", accountCode: "8100", taxTag: "PPH_25", priority: 15 },
  { pattern: "PAYROLL", direction: "OUT", accountCode: "6100", taxTag: null, priority: 30 },
  { pattern: "GAJI", direction: "OUT", accountCode: "6100", taxTag: null, priority: 30 },
  { pattern: "BPJS", direction: "OUT", accountCode: "6110", taxTag: null, priority: 30 },
  { pattern: "PLN", direction: "OUT", accountCode: "6130", taxTag: null, priority: 40 },
  { pattern: "PDAM", direction: "OUT", accountCode: "6130", taxTag: null, priority: 40 },
  { pattern: "TELKOM", direction: "OUT", accountCode: "6130", taxTag: null, priority: 40 },
  { pattern: "INDIHOME", direction: "OUT", accountCode: "6130", taxTag: null, priority: 40 },
  { pattern: "GOJEK", direction: "OUT", accountCode: "6140", taxTag: null, priority: 50 },
  { pattern: "GRAB", direction: "OUT", accountCode: "6140", taxTag: null, priority: 50 },
];
