import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { addMember } from "../members";
import { createClient } from "@/lib/setup";

const current = vi.hoisted(() => ({ session: null as unknown }));
vi.mock("@/lib/auth/session", async (original) => ({ ...(await original<typeof import("@/lib/auth/session")>()), getWorkspaceSession: async () => current.session }));
const { AccessError, accessView, checkCapability, resolveSupportWorkspace } = await import("@/lib/auth/session");
const { endSupportSession, NEEDS_MFA, resolveSupportSession, startSupportSession, SUPPORT_READ_ONLY } = await import("@/lib/auth/support");
const { recordExport } = await import("@/lib/reports/export-log");

const ops = (disabled = false) => db.platformAdmin.create({ data: { userId: randomUUID(), email: `ops-${randomUUID()}@buku.test`, name: "Ops", disabled } });
const reason = "Neraca Agustus tidak seimbang";

describe("support sessions (T18)", () => {
  beforeEach(async () => { await resetDb(); current.session = null; });

  it("needs two-step login, a reason and a member of the organisation; one live session per admin", async () => {
    const g = await makeGroup();
    const admin = await ops();
    const member = await addMember(g.firm.id, "AKUNTAN", { clients: [g.client.id] });
    const base = { adminId: admin.id, firmId: g.firm.id, asMemberId: member.id, reason };
    await expect(startSupportSession(db, { ...base, aal: "aal1" })).rejects.toThrow(NEEDS_MFA);
    await expect(startSupportSession(db, { ...base, aal: "aal2", reason: "cek" })).rejects.toThrow("min. 10");
    const other = await db.$transaction((tx) => createClient(tx, g.firm.id, { name: "Lain", industry: "x", entities: [] }));
    expect(other).toBeTruthy();
    await expect(startSupportSession(db, { ...base, aal: "aal2", asMemberId: randomUUID() })).rejects.toThrow("tidak ditemukan");
    const now = new Date("2026-10-10T03:00:00Z");
    const first = await startSupportSession(db, { ...base, aal: "aal2" }, now);
    expect(first.expiresAt.getTime() - first.startedAt.getTime()).toBe(60 * 60_000);
    const second = await startSupportSession(db, { ...base, aal: "aal2" }, new Date("2026-10-10T03:05:00Z"));
    expect((await db.supportSession.findUniqueOrThrow({ where: { id: first.id } })).endedAt).not.toBeNull();
    expect((await db.supportSession.findUniqueOrThrow({ where: { id: second.id } })).endedAt).toBeNull();
    expect(await db.platformAuditEvent.count({ where: { kind: "SUPPORT_START" } })).toBe(2);
    expect(await db.auditEvent.count()).toBe(0);
  });

  it("resolves only for its own admin, at aal2, live and unexpired", async () => {
    const g = await makeGroup();
    const admin = await ops();
    const member = await addMember(g.firm.id, "OWNER");
    const now = new Date("2026-10-10T03:00:00Z");
    const s = await startSupportSession(db, { adminId: admin.id, aal: "aal2", firmId: g.firm.id, asMemberId: member.id, reason }, now);
    expect(await resolveSupportSession(db, admin.userId, "aal2", s.id, new Date("2026-10-10T03:30:00Z"))).not.toBeNull();
    expect(await resolveSupportSession(db, admin.userId, "aal1", s.id, new Date("2026-10-10T03:30:00Z"))).toBeNull();
    expect(await resolveSupportSession(db, admin.userId, "aal2", s.id, new Date("2026-10-10T04:00:01Z"))).toBeNull();
    expect(await resolveSupportSession(db, (await ops()).userId, "aal2", s.id, new Date("2026-10-10T03:30:00Z"))).toBeNull();
    expect(await resolveSupportSession(db, member.userId, "aal2", s.id, new Date("2026-10-10T03:30:00Z"))).toBeNull();
    await db.platformAdmin.update({ where: { id: admin.id }, data: { disabled: true } });
    expect(await resolveSupportSession(db, admin.userId, "aal2", s.id, new Date("2026-10-10T03:30:00Z"))).toBeNull();
    await db.platformAdmin.update({ where: { id: admin.id }, data: { disabled: false } });
    await endSupportSession(db, admin.id, s.id, new Date("2026-10-10T03:20:00Z"));
    expect(await resolveSupportSession(db, admin.userId, "aal2", s.id, new Date("2026-10-10T03:30:00Z"))).toBeNull();
  });

  it("sees exactly the member's view, reads even a suspended organisation, and never writes", async () => {
    const g = await makeGroup();
    const two = await db.$transaction((tx) => createClient(tx, g.firm.id, { name: "Klien Dua", industry: "retail", entities: [] }));
    const member = await addMember(g.firm.id, "AKUNTAN", { clients: [g.client.id] });
    await db.firm.update({ where: { id: g.firm.id }, data: { suspendedAt: new Date("2026-01-01T00:00:00Z") } });
    const support = { id: "s1", adminName: "Ops", firmId: g.firm.id, firmName: "KJA Uji", memberName: member.name, expiresAt: new Date(Date.now() + 3_600_000) };
    const session = (await resolveSupportWorkspace(db, member.id, support))!;
    expect(session.clientIds).toEqual([g.client.id]);
    await checkCapability(db, session, "books.read", { clientId: g.client.id });
    await expect(checkCapability(db, session, "books.read", { clientId: two.client.id })).rejects.toBeInstanceOf(AccessError);
    await expect(checkCapability(db, session, "books.write", { clientId: g.client.id })).rejects.toThrow(SUPPORT_READ_ONLY);
    expect(accessView(session)).toEqual({ canWrite: false, reason: SUPPORT_READ_ONLY });
    // Another organisation's member is never reached through this firm's support session.
    const foreign = await addMember((await db.$transaction((tx) => import("@/lib/setup").then((m) => m.createFirm(tx, "Lain")))).id, "OWNER");
    expect(await resolveSupportWorkspace(db, foreign.id, support)).toBeNull();
  });

  it("a download in a support session goes to Buku's log, not the organisation's Riwayat", async () => {
    const g = await makeGroup();
    const admin = await ops();
    const member = await addMember(g.firm.id, "OWNER");
    const s = await startSupportSession(db, { adminId: admin.id, aal: "aal2", firmId: g.firm.id, asMemberId: member.id, reason });
    current.session = { support: { id: s.id }, member };
    await recordExport(db, { clientId: g.client.id, scope: "Gabungan", year: 2026, month: 8, file: "Laporan keuangan (Excel)", final: false });
    expect(await db.auditEvent.count()).toBe(0);
    expect(await db.supportSessionView.findMany({ where: { sessionId: s.id } })).toMatchObject([{ kind: "EXPORT" }]);
    current.session = { support: null, member };
    await recordExport(db, { clientId: g.client.id, scope: "Gabungan", year: 2026, month: 8, file: "Laporan keuangan (Excel)", final: false });
    expect(await db.auditEvent.count({ where: { kind: "REPORT_EXPORT" } })).toBe(1);
  });
});
