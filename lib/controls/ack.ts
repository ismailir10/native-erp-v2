import type { Db } from "@/lib/db";
import { recordEvent } from "@/lib/audit";
import { formatPeriod } from "@/lib/format";

/**
 * A note that acknowledges a REVIEW control for a month (rule 23). Overwriting it keeps the earlier note in the change log (ADR 0013),
 * so "Dicek, wajar" can't silently replace what someone wrote before.
 */
export async function saveControlNote(db: Db, input: { clientId: string; periodId: string; year: number; month: number; controlKey: string; title?: string; note: string; detail: string | null; actorId?: string | null }) {
  return db.$transaction(async (tx) => {
    const prev = await tx.controlAck.findUnique({ where: { periodId_controlKey: { periodId: input.periodId, controlKey: input.controlKey } } });
    const ack = await tx.controlAck.upsert({
      where: { periodId_controlKey: { periodId: input.periodId, controlKey: input.controlKey } },
      create: { periodId: input.periodId, controlKey: input.controlKey, note: input.note, detail: input.detail, ackedById: input.actorId ?? null },
      update: { note: input.note, detail: input.detail, ackedById: input.actorId ?? null },
    });
    if (prev?.note !== input.note) {
      await recordEvent(tx, {
        clientId: input.clientId,
        kind: "CONTROL_NOTE",
        subject: `control:${input.periodId}:${input.controlKey}`,
        summary: `${prev ? "Catatan diganti" : "Catatan ditulis"} untuk ${input.title ?? input.controlKey} (${formatPeriod(input.year, input.month)}): ${input.note}`,
        before: prev ? { note: prev.note, detail: prev.detail } : undefined,
        after: { note: input.note, detail: input.detail },
        actorId: input.actorId,
      });
    }
    return ack;
  });
}
