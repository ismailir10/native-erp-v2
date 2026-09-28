import type { AccountType, ScheduleKind } from "@/lib/generated/prisma/enums";

/**
 * Where a schedule form was opened from: a ledger candidate's kind, entity, source entry and the account of the line it came
 * from (the last part of its key), or nothing (a blank form).
 */
export type FormOrigin = { kind: ScheduleKind; entityId: string; sourceEntryId: string | null; code: string; side: "debit" | "credit" } | null;

export function originOf(c: { kind: ScheduleKind; entityId: string; sourceEntryId: string | null; key: string; debitCode: string | null; creditCode: string }): FormOrigin {
  const code = c.key.split(":").at(-1) ?? "";
  // The side the line's account amortises on: a prepayment is credited, deferred revenue debited.
  return { kind: c.kind, entityId: c.entityId, sourceEntryId: c.sourceEntryId, code, side: c.debitCode === code ? "debit" : "credit" };
}

/** A depreciation writes an asset down: an expense on the debit side, accumulated depreciation (or the asset itself) on the credit side. */
export const depreciates = (debit: { type: AccountType } | undefined, credit: { fsLine: string } | undefined) =>
  debit?.type === "BEBAN" && (credit?.fsLine === "AKUM_PENYUSUTAN" || credit?.fsLine === "ASET_TETAP");

/**
 * The source a schedule records when saved: the candidate's entry and line (its account), only while the schedule still releases
 * that line — same kind and entity, and for a prepayment or deferred revenue the account still on the side it amortises on
 * (prepaid credit / deferred-revenue debit), for a depreciation accounts that still depreciate (its memo is free, since the line
 * is stored). Anything else records no source, so a schedule never cites a line it doesn't release (the candidate then stays
 * proposed).
 */
export function sourceFor(
  origin: FormOrigin,
  form: { kind: ScheduleKind; entityId: string; debitCode: string; creditCode: string },
  accounts: { code: string; type: AccountType; fsLine: string }[],
): { sourceEntryId: string; sourceAccountCode: string } | null {
  if (!origin?.sourceEntryId || origin.kind !== form.kind || origin.entityId !== form.entityId) return null;
  const byCode = (code: string) => accounts.find((a) => a.code === code);
  const releases = form.kind === "DEPRECIATION" ? depreciates(byCode(form.debitCode), byCode(form.creditCode)) : (origin.side === "credit" ? form.creditCode : form.debitCode) === origin.code;
  return releases ? { sourceEntryId: origin.sourceEntryId, sourceAccountCode: origin.code } : null;
}
