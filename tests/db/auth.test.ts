import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "../helpers";
import { initializeWorkspace, inviteUser, listMembers, revokeUser, type AuthApi } from "@/lib/auth/operator";

const email = "member@example.test";
/** Fake of the Supabase admin API: records calls, mints ids, never sends mail. */
function fakeAdmin() {
  const calls: { method: string; args: unknown[] }[] = [];
  const ok = (data: unknown) => ({ data, error: null });
  const auth = {
    admin: {
      inviteUserByEmail: vi.fn(async (...args: unknown[]) => { calls.push({ method: "invite", args }); return ok({ user: { id: randomUUID() } }); }),
      updateUserById: vi.fn(async (...args: unknown[]) => { calls.push({ method: "update", args }); return ok({ user: {} }); }),
      createUser: vi.fn(),
    },
    resetPasswordForEmail: vi.fn(async (...args: unknown[]) => { calls.push({ method: "reset", args }); return ok({}); }),
  } as unknown as AuthApi;
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

  it("takes over an address left in Auth without a member, and never leaves a new Auth user without one", async () => {
    const firm = await db.firm.create({ data: { name: "Kantor" } });
    const { auth, calls } = fakeAdmin();
    // An earlier invitation created the Auth user, then the member insert failed: Supabase now refuses a second invitation.
    const orphanId = randomUUID();
    auth.admin.inviteUserByEmail = vi.fn(async () => ({ data: { user: null }, error: { message: "A user with this email address has already been registered" } })) as never;
    auth.admin.listUsers = vi.fn(async () => ({ data: { users: [{ id: orphanId, email }] }, error: null })) as never;
    const member = await inviteUser(db, auth, { email, name: "Member", firmId: firm.id });
    expect(member.userId).toBe(orphanId);
    expect(calls.map((c) => c.method)).toEqual(["update", "reset"]); // unbanned and sent a password link

    // A fresh Auth user whose member insert fails is deleted again, so a retry starts clean.
    const fresh = randomUUID();
    auth.admin.inviteUserByEmail = vi.fn(async () => ({ data: { user: { id: fresh } }, error: null })) as never;
    const deleteUser = vi.fn(async () => ({ data: {}, error: null }));
    auth.admin.deleteUser = deleteUser as never;
    const failing = (insert: () => Promise<unknown>) =>
      ({ firm: db.firm, firmMember: { findUnique: (a: never) => db.firmMember.findUnique(a), create: async () => { await insert(); throw new Error("insert failed"); } } }) as unknown as typeof db;
    await expect(inviteUser(failing(async () => undefined), auth, { email: "third@example.test", name: "Third", firmId: firm.id })).rejects.toThrow("insert failed");
    expect(deleteUser).toHaveBeenCalledWith(fresh);
    expect(await db.firmMember.count()).toBe(1);
  });

  it("finds the orphan past the first page of Auth users, and keeps an Auth user a concurrent invitation adopted", async () => {
    const firm = await db.firm.create({ data: { name: "Kantor" } });
    const { auth } = fakeAdmin();
    const orphanId = randomUUID();
    auth.admin.inviteUserByEmail = vi.fn(async () => ({ data: { user: null }, error: { message: "already registered" } })) as never;
    const listUsers = vi.fn(async ({ page }: { page: number }) => ({
      data: { users: page === 1 ? Array.from({ length: 1000 }, (_, i) => ({ id: randomUUID(), email: `u${i}@example.test` })) : [{ id: orphanId, email }] },
      error: null,
    }));
    auth.admin.listUsers = listUsers as never;
    expect((await inviteUser(db, auth, { email, name: "Member", firmId: firm.id })).userId).toBe(orphanId);
    expect(listUsers).toHaveBeenCalledTimes(2);

    // Our insert lost to a concurrent invitation that took over the same fresh Auth user: it is theirs now, never deleted.
    const adopted = randomUUID();
    auth.admin.inviteUserByEmail = vi.fn(async () => ({ data: { user: { id: adopted } }, error: null })) as never;
    const deleteUser = vi.fn(async () => ({ data: {}, error: null }));
    auth.admin.deleteUser = deleteUser as never;
    const racing = ({
      firm: db.firm,
      firmMember: {
        findUnique: (a: never) => db.firmMember.findUnique(a),
        create: async () => {
          await db.firmMember.create({ data: { userId: adopted, email: "second@example.test", name: "Second", firmId: firm.id } });
          throw new Error("Unique constraint failed on userId");
        },
      },
    }) as unknown as typeof db;
    await expect(inviteUser(racing, auth, { email: "second@example.test", name: "Second", firmId: firm.id })).rejects.toThrow("Unique constraint");
    expect(deleteUser).not.toHaveBeenCalled();
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

  it("revokes by disabling the member and banning the Supabase user; re-invitation lifts the ban and emails a recovery link", async () => {
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
      { method: "reset", args: [email, {}] },
    ]);
    expect(auth.admin.inviteUserByEmail).toHaveBeenCalledTimes(1);
  });

  it("does not store a member when Supabase refuses the invitation", async () => {
    const firm = await db.firm.create({ data: { name: "Kantor" } });
    const { auth } = fakeAdmin();
    (auth.admin.inviteUserByEmail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: { user: null }, error: { message: "email rate limit exceeded" } });
    await expect(inviteUser(db, auth, { email, name: "Member", firmId: firm.id })).rejects.toThrow("Undangan belum terkirim");
    expect(await db.firmMember.count()).toBe(0);
  });
});
