import type { ScheduleKind } from "@/lib/generated/prisma/enums";

/** Where a schedule form was opened from: a ledger candidate's kind and source entry, or nothing (a blank form). */
export type FormOrigin = { kind: ScheduleKind; sourceEntryId: string | null } | null;

/**
 * The source entry a schedule cites after its kind is changed in the form: the candidate's own entry while the kind is the
 * candidate's (also after switching away and back), none for any other kind. A schedule of another kind came from no candidate.
 */
export const sourceForKind = (origin: FormOrigin, kind: ScheduleKind): string | null => (origin && origin.kind === kind ? origin.sourceEntryId : null);
