import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { addMember } from "../members";
import type { AuthApi } from "@/lib/auth/operator";
import { approveSignup, rejectSignup, SignupError, submitSignup } from "@/lib/signup";
import { accessState } from "@/lib/access/grant";

function fakeAuth(fail = false) {
  const ok = (data: unknown) => ({ data, error: null });
  return {
    admin: {
      inviteUserByEmail: vi.fn(async () => (fail ? { data: { user: null }, error: { message: "smtp down" } } : ok({ user: { id: randomUUID() } }))),
      updateUserById: vi.fn(async () => ok({ user: {} })),
      createUser: vi.fn(),
      listUsers: vi.fn(async () => ok({ users: [] })),
    },
    resetPasswordForEmail: vi.fn(async () => ok({})),
  } as unknown as AuthApi;
}
const ops = () => db.platformAdmin.create({ data: { userId: randomUUID(), email: `ops-${randomUUID()}@buku.test`, name: "Ops" } });
const input = (over: Record<string, string> = {}) => ({ email: "Pemilik@KAP-Maju.test", name: "Sari", orgName: "KAP Maju & Rekan", orgKind: "KANTOR_AKUNTAN", phone: "0812", note: "40 klien", ...over });

describe("trial requests (T09)", () => {
  beforeEach(resetDb);

  it("stores one pending request per address; bots, duplicates and the 6th request in an hour are dropped silently", async () => {
    const now = new Date("2026-10-10T03:00:00Z");
    expect(await submitSignup(db, input(), "1.1.1.1", now)).toEqual({ stored: true });
    expect(await submitSignup(db, input(), "1.1.1.1", now)).toEqual({ stored: false }); // already pending
    expect(await submitSignup(db, input({ email: "bot@x.test", website: "http://spam" }), "9.9.9.9", now)).toEqual({ stored: false });
    for (let i = 0; i < 4; i++) await submitSignup(db, input({ email: `orang${i}@x.test` }), "2.2.2.2", now);
    expect(await submitSignup(db, input({ email: "kelima@x.test" }), "2.2.2.2", now)).toEqual({ stored: true });
    expect(await submitSignup(db, input({ email: "keenam@x.test" }), "2.2.2.2", now)).toEqual({ stored: false });
    expect(await submitSignup(db, input({ email: "keenam@x.test" }), "2.2.2.2", new Date("2026-10-10T04:00:01Z"))).toEqual({ stored: true });
    expect(await db.signupRequest.count()).toBe(7);
    expect((await db.signupRequest.findFirstOrThrow({ where: { email: "pemilik@kap-maju.test" } })).orgName).toBe("KAP Maju & Rekan");
    await expect(submitSignup(db, input({ email: "bukan-email" }), null, now)).rejects.toBeInstanceOf(SignupError);
    await expect(submitSignup(db, input({ orgKind: "LAIN" }), null, now)).rejects.toThrow("Pilih kantor akuntan");
  });

  it("approval creates the organisation, a trial grant and the owner's invitation with the trial details", async () => {
    const admin = await ops();
    await submitSignup(db, input({ orgKind: "PERUSAHAAN", orgName: "PT Maju Jaya" }), null);
    const request = await db.signupRequest.findFirstOrThrow();
    const auth = fakeAuth();
    const firm = await approveSignup(db, auth, admin.id, request.id, { endsOn: "2026-10-24" }, new Date("2026-10-10T03:00:00Z"));
    const owner = await db.firmMember.findUniqueOrThrow({ where: { email: "pemilik@kap-maju.test" } });
    expect(owner).toMatchObject({ firmId: firm.id, role: "OWNER", name: "Sari" });
    expect(auth.admin.inviteUserByEmail).toHaveBeenCalledWith("pemilik@kap-maju.test", expect.objectContaining({ data: expect.objectContaining({ org_name: "PT Maju Jaya", org_kind: "PERUSAHAAN", access_until: "24 Okt 2026", name: "Sari" }) }));
    const org = await db.firm.findUniqueOrThrow({ where: { id: firm.id }, include: { grants: true, clients: true } });
    expect(org.kind).toBe("PERUSAHAAN");
    expect(org.clients.map((c) => c.name)).toEqual(["PT Maju Jaya"]);
    expect(accessState(org.grants, org, new Date("2026-10-20T00:00:00Z"))).toMatchObject({ state: "ACTIVE", kind: "TRIAL", daysLeft: 4 });
    expect(await db.signupRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ status: "APPROVED", firmId: firm.id, decidedById: admin.id });
    await expect(approveSignup(db, auth, admin.id, request.id, { endsOn: "2026-10-24" })).rejects.toThrow("sudah diputuskan");
  });

  it("a failed invitation leaves no organisation, grant or log behind; the request stays pending", async () => {
    const admin = await ops();
    await submitSignup(db, input(), null);
    const request = await db.signupRequest.findFirstOrThrow();
    await expect(approveSignup(db, fakeAuth(true), admin.id, request.id, { endsOn: "2026-10-24" })).rejects.toThrow();
    expect(await db.firm.count()).toBe(0);
    expect(await db.accessGrant.count()).toBe(0);
    expect(await db.platformAuditEvent.count()).toBe(0);
    expect((await db.signupRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("PENDING");
  });

  it("refuses an address that already belongs to an organisation, and rejects with a reason", async () => {
    const admin = await ops();
    const g = await makeGroup();
    const member = await addMember(g.firm.id, "AKUNTAN");
    await submitSignup(db, input({ email: member.email }), null);
    const request = await db.signupRequest.findFirstOrThrow();
    await expect(approveSignup(db, fakeAuth(), admin.id, request.id, { endsOn: "2026-10-24" })).rejects.toThrow("sudah menjadi anggota");
    await expect(rejectSignup(db, admin.id, request.id, "x")).rejects.toThrow("min. 5");
    await rejectSignup(db, admin.id, request.id, "Sudah memakai Buku");
    expect(await db.signupRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ status: "REJECTED", reason: "Sudah memakai Buku" });
    expect(await db.platformAuditEvent.count({ where: { kind: "SIGNUP_REJECTED" } })).toBe(1);
  });
});
