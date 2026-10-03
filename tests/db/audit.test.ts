import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { listEvents, recordEvent } from "@/lib/audit";

/** ADR 0013: the change log is append-only and newest first. */
describe("riwayat perubahan", () => {
  beforeEach(resetDb);

  it("keeps events newest first, filters by kind and subject, and refuses to rewrite one", async () => {
    const g = await makeGroup();
    const a = await recordEvent(db, { clientId: g.client.id, kind: "CLASSIFY", subject: "bankTx:1", summary: "6190 → 6120", before: { accountCode: "6190" }, after: { accountCode: "6120" } });
    await recordEvent(db, { clientId: g.client.id, kind: "CONTROL_NOTE", subject: "control:p:suspense", summary: "Catatan diganti" });
    expect((await listEvents(db, g.client.id)).map((e) => e.kind)).toEqual(["CONTROL_NOTE", "CLASSIFY"]);
    expect((await listEvents(db, g.client.id, { subject: "bankTx:1" })).map((e) => [e.label, e.actor, e.after])).toEqual([["Klasifikasi mutasi", "Sistem", { accountCode: "6120" }]]);
    await expect(db.auditEvent.update({ where: { id: a.id }, data: { summary: "diubah" } })).rejects.toThrow(/append-only/);
  });
});
