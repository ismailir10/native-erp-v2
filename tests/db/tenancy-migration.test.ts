import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { createClient } from "@/lib/setup";

// The backfill is written to be idempotent, so it is replayed here on data created after the migrations ran.
const backfill = readFileSync("prisma/migrations/20261009232748_trial_tenants_backfill/migration.sql", "utf8")
  .split(/;\s*\n/)
  .map((sql) => sql.replace(/^\s*--.*$/gm, "").trim())
  .filter(Boolean);
const runBackfill = async () => { for (const sql of backfill) await db.$executeRawUnsafe(sql); };

const member = (firmId: string, role: "ADMIN" | "AKUNTAN", name: string, createdAt: Date, disabled = false) =>
  db.firmMember.create({ data: { firmId, userId: randomUUID(), email: `${name}-${randomUUID()}@example.test`, name, role, createdAt, disabled } });

const admin = () => db.platformAdmin.create({ data: { userId: randomUUID(), email: `ops-${randomUUID()}@example.test`, name: "Ops" } });

describe("trial tenants backfill (M1)", () => {
  beforeEach(resetDb);

  it("keeps what existed working: open-ended COMP grant, roles untouched, akuntan sees every client", async () => {
    const g = await makeGroup();
    const second = await db.$transaction((tx) => createClient(tx, g.firm.id, { name: "Klien Dua", industry: "retail", entities: [{ name: "PT Dua", shortName: "Dua", kind: "PT", banks: [] }] }));
    await member(g.firm.id, "ADMIN", "disabled-first", new Date("2026-01-01"), true);
    const first = await member(g.firm.id, "ADMIN", "first", new Date("2026-02-01"));
    const later = await member(g.firm.id, "ADMIN", "later", new Date("2026-03-01"));
    const akuntan = await member(g.firm.id, "AKUNTAN", "akuntan", new Date("2026-03-02"));

    await runBackfill();
    await runBackfill(); // idempotent

    const grants = await db.accessGrant.findMany({ where: { firmId: g.firm.id } });
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ kind: "COMP", endsAt: null, revokedAt: null });
    // FirmMember is protected from migrations: nobody's role changes.
    expect((await db.firmMember.findUniqueOrThrow({ where: { id: first.id } })).role).toBe("ADMIN");
    expect((await db.firmMember.findUniqueOrThrow({ where: { id: later.id } })).role).toBe("ADMIN");
    expect(await db.firmMember.count({ where: { firmId: g.firm.id, role: "OWNER" } })).toBe(0);
    const assigned = await db.clientAccess.findMany({ where: { memberId: akuntan.id }, select: { clientId: true } });
    expect(assigned.map((a) => a.clientId).sort()).toEqual([g.client.id, second.client.id].sort());
  });

  it("guards the new tables in the database", async () => {
    const g = await makeGroup();
    const ops = await admin();
    const start = new Date("2026-10-01T00:00:00Z");
    await expect(db.accessGrant.create({ data: { firmId: g.firm.id, kind: "TRIAL", startsAt: start, endsAt: start } })).rejects.toThrow();
    await expect(db.firm.update({ where: { id: g.firm.id }, data: { seatLimit: 0 } })).rejects.toThrow();

    const owner = await member(g.firm.id, "ADMIN", "owner", start);
    await expect(db.supportSession.create({ data: { adminId: ops.id, firmId: g.firm.id, asMemberId: owner.id, reason: "Cek laporan", startedAt: start, expiresAt: new Date(start.getTime() + 61 * 60_000) } })).rejects.toThrow();
    await expect(db.supportSession.create({ data: { adminId: ops.id, firmId: g.firm.id, asMemberId: owner.id, reason: "pendek", startedAt: start, expiresAt: new Date(start.getTime() + 30 * 60_000) } })).rejects.toThrow();
    const session = await db.supportSession.create({ data: { adminId: ops.id, firmId: g.firm.id, asMemberId: owner.id, reason: "Neraca tidak seimbang di Agustus", startedAt: start, expiresAt: new Date(start.getTime() + 60 * 60_000) } });

    // Only ending a session is allowed; Buku's logs are append-only.
    await expect(db.supportSession.update({ where: { id: session.id }, data: { reason: "Diubah sesudahnya oleh admin" } })).rejects.toThrow(/append-only/);
    await db.supportSession.update({ where: { id: session.id }, data: { endedAt: new Date(start.getTime() + 10 * 60_000) } });
    await expect(db.supportSession.update({ where: { id: session.id }, data: { endedAt: new Date() } })).rejects.toThrow(/append-only/);
    await expect(db.supportSession.delete({ where: { id: session.id } })).rejects.toThrow(/append-only/);
    const view = await db.supportSessionView.create({ data: { sessionId: session.id, path: "/clients/x/reports" } });
    await expect(db.supportSessionView.delete({ where: { id: view.id } })).rejects.toThrow(/append-only/);
    const event = await db.platformAuditEvent.create({ data: { adminId: ops.id, firmId: g.firm.id, kind: "GRANT", summary: "Uji coba 14 hari" } });
    await expect(db.platformAuditEvent.update({ where: { id: event.id }, data: { summary: "x" } })).rejects.toThrow(/append-only/);
    await expect(db.platformAuditEvent.delete({ where: { id: event.id } })).rejects.toThrow(/append-only/);
  });
});
