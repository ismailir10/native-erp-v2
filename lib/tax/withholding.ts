import type { Direction, WithholdingKind } from "@/lib/generated/prisma/enums";
import { ACCOUNT_CODES } from "@/lib/coa/template";
import { LedgerError } from "@/lib/ledger/post";

/**
 * Tax withheld from a payment (accounting-rules 5h). The payer pays the counterparty net and DJP the rest; the counterparty books the
 * withheld part as a prepaid credit (PPh 22/23) or as final tax (PPh 4(2) is not creditable), the payer as a liability until it remits.
 */
export type Withholding = { kind: WithholdingKind; amount: bigint };

export const WITHHOLDING_KINDS: WithholdingKind[] = ["PPH_23", "PPH_22", "PPH_4_2", "PPH_21"];
export const WITHHOLDING_LABEL: Record<WithholdingKind, string> = { PPH_21: "PPh 21", PPH_22: "PPh 22", PPH_23: "PPh 23", PPH_4_2: "PPh 4(2)" };

/** Kinds a receipt (money in: the customer withholds) can carry; PPh 21 is an employer's duty. */
export const RECEIPT_KINDS: WithholdingKind[] = ["PPH_23", "PPH_22", "PPH_4_2"];

/** The account of the tax leg: a receipt's credit (1180) or final tax (8200); a payment's liability (2140 PPh 21, 2141 PPh 23, 2145 the rest). */
export function withholdingAccountCode(kind: WithholdingKind, direction: Direction): string {
  if (direction === "IN") return kind === "PPH_4_2" ? ACCOUNT_CODES.FINAL_TAX : ACCOUNT_CODES.PREPAID_TAX;
  return kind === "PPH_21" ? "2140" : kind === "PPH_23" ? "2141" : "2145";
}

/** Tax on a base at a percentage ("2", "1,5", "10"), half up to whole minor units. */
export function withholdingFor(base: bigint, rate: string): bigint {
  const m = rate.trim().match(/^(\d{1,3})(?:[.,](\d{1,2}))?$/);
  if (!m) throw new LedgerError("Tarif harus berupa persen, mis. 2 atau 1,5.");
  const hundredths = BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
  if (hundredths <= 0n || hundredths > 10_000n) throw new LedgerError("Tarif harus berupa persen antara 0 dan 100.");
  return (base * hundredths + 5_000n) / 10_000n;
}

/** A withholding that fits the payment's direction and is positive; throws a Bahasa message otherwise. */
export function checkWithholding(w: Withholding, direction: Direction): Withholding {
  if (w.amount <= 0n) throw new LedgerError("Nominal pemotongan harus lebih dari nol.");
  if (direction === "IN" && !RECEIPT_KINDS.includes(w.kind)) throw new LedgerError("Uang masuk hanya bisa dipotong PPh 23, PPh 22 atau PPh 4(2) oleh pelanggan.");
  return w;
}
