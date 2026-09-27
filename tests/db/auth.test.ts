import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "../helpers";
import { initializeWorkspace, inviteUser, listMembers, revokeUser, type AuthAdmin } from "@/lib/auth/operator";

const email = "member@example.test";
/** Fake of the Supabase admin API: records calls, mints ids, never sends mail. */
function fakeAdmin() {
  const calls: { method: string; args: unknown[] }[] = [];
  const ok = (data: unknown) => ({ data, error: null });
  const auth = {
    inviteUserByEmail: vi.fn(async (...args: unknown[]) => { calls.push({ method: "invite", args }); return ok({ user: { id: randomUUID() } }); }),
    updateUserById: vi.fn(async (...args: unknown[]) => { calls.push({ method: "update", args }); return ok({ user: {} }); }),
    generateLink: vi.fn(async (...args: unknown[]) => { calls.push({ method: "link", args }); return ok({ properties: {} }); }),
    createUser: vi.fn(),
  } as unknown as AuthAdmin;
  return { auth, calls };
}

describe("invitation-only membership", () => {
  beforeEach(async () => { await resetDb(); });

  it("bootstraps exactly one firm under concurrent operator requests", async () => {
    const results = await Promise.allSettled([initializeWorkspace(db, "Kantor"), initializeWorkspace(db, "Other")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.firm.count()).toBe(1);
  });

  it("invites through Supabase and stores the member with its role and the callback of this deployment", async () => {
    const firm = await db.firm.create({ data: { name: "Kantor" } });
    const { auth, calls } = fakeAdmin();
    const member = await inviteUser(db, auth, { email: " Member@Example.TEST ", name: "Member", firmId: firm.id, role: "ADMIN", redirectTo: "http://localhost:3000/" });
    expect(member).toMatchObject({ email, name: "Member", role: "ADMIN", disabled: false, firmId: firm.id });
    expect(calls).toEqual([{ method: "invite", args: [email, { data: { name: "Member" }, redirectTo: "http://localhost:3000/auth/callback" }] }]);
    expect((await listMembers(db)).map((m) => m.email)).toEqual([email]);
  });

  it("refuses to move an address to another firm and refuses unknown firms", async () => {
    const firm = await db.firm.create({ data: { name: "Kantor" } });
    const other = await db.firm.create({ data: { name: "Lain" } });
    const { auth } = fakeAdmin();
    await inviteUser(db, auth, { email, name: "Member", firmId: firm.id });
    await expect(inviteUser(db, auth, { email, name: "Member", firmId: other.id })).rejects.toThrow("sudah terhubung ke kantor lain");
    await expect(inviteUser(db, auth, { email: "new@example.test", name: "X", firmId: "missing" })).rejects.toThrow("Kantor tidak ditemukan");
    expect(await db.firmMember.count()).toBe(1);
  });

  it("revokes by disabling the member and banning the Supabase user; re-invitation lifts both", async () => {
    const firm = await db.firm.create({ data: { name: "Kantor" } });
    const { auth, calls } = fakeAdmin();
    const member = await inviteUser(db, auth, { email, name: "Member", firmId: firm.id });
    await revokeUser(db, auth, { email, firmId: firm.id });
    expect((await db.firmMember.findUniqueOrThrow({ where: { id: member.id } })).disabled).toBe(true);
    expect(calls.at(-1)).toEqual({ method: "update", args: [member.userId, { ban_duration: "876600h" }] });
    await expect(revokeUser(db, auth, { email, firmId: "other" })).rejects.toThrow("tidak ditemukan di kantor ini");

    const again = await inviteUser(db, auth, { email, name: "Member Baru", firmId: firm.id });
    expect(again).toMatchObject({ id: member.id, userId: member.userId, name: "Member Baru", disabled: false });
    expect(calls.slice(-2)).toEqual([
      { method: "update", args: [member.userId, { ban_duration: "none" }] },
      { method: "link", args: [{ type: "recovery", email, options: {} }] },
    ]);
    expect(auth.inviteUserByEmail).toHaveBeenCalledTimes(1);
  });

  it("does not store a member when Supabase refuses the invitation", async () => {
    const firm = await db.firm.create({ data: { name: "Kantor" } });
    const { auth } = fakeAdmin();
    (auth.inviteUserByEmail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: { user: null }, error: { message: "email rate limit exceeded" } });
    await expect(inviteUser(db, auth, { email, name: "Member", firmId: firm.id })).rejects.toThrow("Undangan belum terkirim");
    expect(await db.firmMember.count()).toBe(0);
  });
});
