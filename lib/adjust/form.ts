import type { ScheduleKind } from "@/lib/generated/prisma/enums";

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

/**
 * The source entry a schedule cites when saved: the candidate's own entry only while the schedule still identifies that
 * candidate's line — same kind and entity, and the line's account still on the side it amortises on (prepaid credit /
 * deferred-revenue debit) or, for a depreciation (6180/1219, no asset account), still named by its code in the memo. Anything else cites no
 * entry, so a schedule never cites an entry whose line it no longer identifies (the candidate then stays proposed).
 */
export function sourceFor(origin: FormOrigin, form: { kind: ScheduleKind; entityId: string; memo: string; debitCode: string; creditCode: string }): string | null {
  if (!origin?.sourceEntryId || origin.kind !== form.kind || origin.entityId !== form.entityId) return null;
  const identifies =
    form.kind === "DEPRECIATION"
      ? form.memo.toLowerCase().split(/\s+/).includes(origin.code.toLowerCase())
      : (origin.side === "credit" ? form.creditCode : form.debitCode) === origin.code;
  return identifies ? origin.sourceEntryId : null;
}
