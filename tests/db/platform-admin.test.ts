import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { addMember } from "../members";
import { createFirm } from "@/lib/setup";
import { resolvePlatformAdmin } from "@/lib/auth/platform";
import { addOperator, removeOperator, setMemberRole, type AuthApi } from "@/lib/auth/operator";
import { listOrganisations } from "@/lib/backoffice/orgs";

function fakeAuth(known: { id: string; email: string }[] = []) {
  const ok = (data: unknown) => ({ data, error: null });
  return {
    admin: {
      inviteUserByEmail: vi.fn(async () => ok({ user: { id: randomUUID() } })),
      updateUserById: vi.fn(async () => ok({ user: {} })),
      createUser: vi.fn(),
      listUsers: vi.fn(async () => ok({ users: known })),
    },
    resetPasswordForEmail: vi.fn(async () => ok({})),
  } as unknown as AuthApi;
}

describe("Buku admins and the backoffice (T06)", () => {
  beforeEach(resetDb);

  it("only an active Buku admin resolves; a member or a stranger does not", async () => {
    const g = await makeGroup();
    const member = await addMember(g.firm.id, "OWNER");
    const auth = fakeAuth();
    const admin = await addOperator(db, auth, { email: "Ops@Buku.test", name: "Ops" });
    expect(admin.email).toBe("ops@buku.test");
    expect(auth.admin.inviteUserByEmail).toHaveBeenCalledTimes(1);
    expect(await resolvePlatformAdmin(db, admin.userId)).toMatchObject({ id: admin.id });
    expect(await resolvePlatformAdmin(db, member.userId)).toBeNull();
    expect(await resolvePlatformAdmin(db, randomUUID())).toBeNull();
    await removeOperator(db, { email: "ops@buku.test" });
    expect(await resolvePlatformAdmin(db, admin.userId)).toBeNull();
    // Adding again enables the same row; no second invitation.
    const again = await addOperator(db, auth, { email: "ops@buku.test", name: "Ops" });
    expect(again.id).toBe(admin.id);
    expect(await resolvePlatformAdmin(db, admin.userId)).not.toBeNull();
    expect(auth.admin.inviteUserByEmail).toHaveBeenCalledTimes(1);
  });

  it("an organisation member's existing login becomes a Buku admin without a new account", async () => {
    const g = await makeGroup();
    const member = await addMember(g.firm.id, "OWNER");
    const auth = fakeAuth([{ id: member.userId, email: member.email }]);
    const admin = await addOperator(db, auth, { email: member.email, name: "Pemilik dan admin Buku" });
    expect(admin.userId).toBe(member.userId);
    expect(auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("set-role names the first owner and never removes the only active one", async () => {
    const g = await makeGroup();
    const admin = await addMember(g.firm.id, "ADMIN");
    expect((await setMemberRole(db, { firmId: g.firm.id, email: admin.email, role: "OWNER" })).role).toBe("OWNER");
    await expect(setMemberRole(db, { firmId: g.firm.id, email: admin.email, role: "ADMIN" })).rejects.toThrow("satu-satunya pemilik aktif");
    await expect(setMemberRole(db, { firmId: "other", email: admin.email, role: "ADMIN" })).rejects.toThrow("tidak ditemukan");
  });

  it("lists organisations with counts and access only", async () => {
    const g = await makeGroup();
    // The list is read on a fixed clock below; the firm's open grant must already have started then, whatever time the test runs.
    await db.accessGrant.updateMany({ where: { firmId: g.firm.id }, data: { startsAt: new Date("2026-01-01T00:00:00Z") } });
    await addMember(g.firm.id, "OWNER", { name: "pemilik" });
    await db.$transaction((tx) => createFirm(tx, "PT Uji Perusahaan", { kind: "PERUSAHAAN", grant: { kind: "TRIAL", startsAt: new Date("2026-10-01T00:00:00Z"), endsAt: new Date("2026-10-14T16:59:59.999Z") } }));
    const rows = await listOrganisations(db, new Date("2026-10-10T03:00:00Z"));
    const firm = rows.find((r) => r.id === g.firm.id)!;
    expect(firm).toMatchObject({ kind: "KANTOR_AKUNTAN", members: 1, clients: 1, entities: 2, access: { state: "ACTIVE", endsAt: null } });
    expect(firm.ownerEmail).toMatch(/^pemilik-/);
    expect(rows.find((r) => r.name === "PT Uji Perusahaan")).toMatchObject({ kind: "PERUSAHAAN", members: 0, access: { state: "ACTIVE", daysLeft: 4, kind: "TRIAL" } });
    // Metadata only: no client name, amount or file in a row.
    expect(JSON.stringify(rows)).not.toContain("Grup Uji");
  });
});
