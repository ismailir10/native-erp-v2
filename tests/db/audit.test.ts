import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
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

  it("outlives the member who made it: removing the member only forgets the actor, nothing else may change with it", async () => {
    const g = await makeGroup();
    const m = await db.firmMember.create({ data: { firmId: g.firm.id, userId: randomUUID(), email: `m-${randomUUID()}@example.test`, name: "Akuntan Lama", role: "AKUNTAN" } });
    const e = await recordEvent(db, { clientId: g.client.id, kind: "CLASSIFY", subject: "bankTx:1", summary: "6190 → 6120", actorId: m.id });
    await expect(db.auditEvent.update({ where: { id: e.id }, data: { actorId: null, summary: "diubah" } })).rejects.toThrow(/append-only/);
    await db.firmMember.delete({ where: { id: m.id } });
    expect((await listEvents(db, g.client.id)).map((v) => [v.summary, v.actor])).toEqual([["6190 → 6120", "Sistem"]]);
  });
});
