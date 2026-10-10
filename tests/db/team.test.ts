import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { addMember } from "../members";
import { createClient } from "@/lib/setup";
import type { AuthApi } from "@/lib/auth/operator";
import { assignClients, inviteMember, listTeam, setDisabled, setRole, TeamError, transferOwnership, type Actor } from "@/lib/team";

/** Fake Supabase admin API: mints ids, records bans, never sends mail. */
function fakeAuth() {
  const ok = (data: unknown) => ({ data, error: null });
  return {
    admin: {
      inviteUserByEmail: vi.fn(async () => ok({ user: { id: randomUUID() } })),
      updateUserById: vi.fn(async () => ok({ user: {} })),
      createUser: vi.fn(),
    },
    resetPasswordForEmail: vi.fn(async () => ok({})),
  } as unknown as AuthApi;
}
const actorOf = (m: { id: string; role: Actor["role"]; firmId: string }): Actor => ({ id: m.id, role: m.role, firmId: m.firmId });

describe("team management (T11)", () => {
  beforeEach(resetDb);

  it("invites an akuntan with chosen clients only, and refuses addresses already in use", async () => {
    const g = await makeGroup();
    const two = await db.$transaction((tx) => createClient(tx, g.firm.id, { name: "Klien Dua", industry: "retail", entities: [{ name: "PT Dua", shortName: "Dua", kind: "PT", banks: [] }] }));
    const owner = await addMember(g.firm.id, "OWNER");
    const auth = fakeAuth();
    const m = await inviteMember(db, auth, actorOf(owner), { email: "Sari@Example.test", name: "Sari", role: "AKUNTAN", clientIds: [g.client.id] });
    expect(m.email).toBe("sari@example.test");
    expect((await db.clientAccess.findMany({ where: { memberId: m.id } })).map((a) => a.clientId)).toEqual([g.client.id]);
    await expect(inviteMember(db, auth, actorOf(owner), { email: "sari@example.test", name: "Sari", role: "AKUNTAN", clientIds: [] })).rejects.toThrow("sudah menjadi anggota aktif");
    await expect(inviteMember(db, auth, actorOf(owner), { email: "baru@example.test", name: "Baru", role: "AKUNTAN", clientIds: ["foreign"] })).rejects.toThrow("Klien tidak ditemukan");
    expect((await listTeam(db, g.firm.id)).clients.map((c) => c.id).sort()).toEqual([g.client.id, two.client.id].sort());
  });

  it("an admin never touches an owner or makes one; nobody changes themselves", async () => {
    const g = await makeGroup();
    const owner = await addMember(g.firm.id, "OWNER");
    const admin = await addMember(g.firm.id, "ADMIN");
    const akuntan = await addMember(g.firm.id, "AKUNTAN");
    await expect(setRole(db, actorOf(admin), owner.id, "ADMIN")).rejects.toThrow("Hanya pemilik yang dapat mengubah pemilik lain.");
    await expect(setRole(db, actorOf(admin), akuntan.id, "OWNER")).rejects.toThrow("Hanya pemilik yang dapat menjadikan anggota pemilik.");
    await expect(setDisabled(db, fakeAuth(), actorOf(admin), owner.id, true)).rejects.toThrow(TeamError);
    await expect(setRole(db, actorOf(admin), admin.id, "AKUNTAN")).rejects.toThrow("Anda sendiri");
    expect((await setRole(db, actorOf(admin), akuntan.id, "VIEWER")).role).toBe("VIEWER");
  });

  it("keeps the last active owner, and transfers ownership in one step", async () => {
    const g = await makeGroup();
    const owner = await addMember(g.firm.id, "OWNER");
    const second = await addMember(g.firm.id, "OWNER");
    const admin = await addMember(g.firm.id, "ADMIN");
    await setRole(db, actorOf(owner), second.id, "ADMIN");
    // owner is now the only active OWNER: another owner-actor would be needed to demote them, and nobody can disable them.
    const promoted = await setRole(db, actorOf(owner), admin.id, "OWNER");
    await setRole(db, actorOf(promoted), owner.id, "ADMIN");
    await expect(setRole(db, { ...actorOf(owner), role: "ADMIN" }, promoted.id, "AKUNTAN")).rejects.toThrow("Hanya pemilik");
    // Even an owner cannot demote the only active owner: ownership is transferred instead.
    await expect(setRole(db, { ...actorOf(second), role: "OWNER" }, promoted.id, "AKUNTAN")).rejects.toThrow("setidaknya satu pemilik aktif");
    await expect(setDisabled(db, fakeAuth(), { ...actorOf(second), role: "OWNER" }, promoted.id, true)).rejects.toThrow("setidaknya satu pemilik aktif");
    await transferOwnership(db, actorOf(promoted), second.id);
    expect((await db.firmMember.findUniqueOrThrow({ where: { id: second.id } })).role).toBe("OWNER");
    expect((await db.firmMember.findUniqueOrThrow({ where: { id: promoted.id } })).role).toBe("ADMIN");
    await expect(transferOwnership(db, actorOf({ ...promoted, role: "ADMIN" }), owner.id)).rejects.toThrow("Hanya pemilik");
  });

  it("the seat limit counts active members, for invitations and for enabling again", async () => {
    const g = await makeGroup();
    await db.firm.update({ where: { id: g.firm.id }, data: { seatLimit: 2 } });
    const owner = await addMember(g.firm.id, "OWNER");
    const akuntan = await addMember(g.firm.id, "AKUNTAN");
    const auth = fakeAuth();
    await expect(inviteMember(db, auth, actorOf(owner), { email: "ketiga@example.test", name: "Ketiga", role: "VIEWER", clientIds: [] })).rejects.toThrow("Batas 2 anggota aktif");
    await setDisabled(db, auth, actorOf(owner), akuntan.id, true);
    expect((await db.firmMember.findUniqueOrThrow({ where: { id: akuntan.id } })).disabled).toBe(true);
    await inviteMember(db, auth, actorOf(owner), { email: "ketiga@example.test", name: "Ketiga", role: "VIEWER", clientIds: [g.client.id] });
    await expect(setDisabled(db, auth, actorOf(owner), akuntan.id, false)).rejects.toThrow("Batas 2 anggota aktif");
  });

  it("assigns clients to an akuntan or viewer, never to an admin", async () => {
    const g = await makeGroup();
    const owner = await addMember(g.firm.id, "OWNER");
    const viewer = await addMember(g.firm.id, "VIEWER");
    const admin = await addMember(g.firm.id, "ADMIN");
    await assignClients(db, actorOf(owner), viewer.id, [g.client.id, g.client.id]);
    expect(await db.clientAccess.count({ where: { memberId: viewer.id } })).toBe(1);
    await assignClients(db, actorOf(owner), viewer.id, []);
    expect(await db.clientAccess.count({ where: { memberId: viewer.id } })).toBe(0);
    await expect(assignClients(db, actorOf(owner), admin.id, [g.client.id])).rejects.toThrow("melihat semua klien");
  });
});
