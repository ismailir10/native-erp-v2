import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { createClient, createFirm } from "@/lib/setup";
import { AccessError, accessibleClientWhere, checkCapability, resolveWorkspace } from "@/lib/auth/session";
import type { MemberRole } from "@/lib/generated/prisma/enums";

const member = (firmId: string, role: MemberRole) =>
  db.firmMember.create({ data: { firmId, userId: randomUUID(), email: `${role}-${randomUUID()}@example.test`, name: role, role } });

async function twoOrgs() {
  const a = await makeGroup();
  const second = await db.$transaction((tx) => createClient(tx, a.firm.id, { name: "Klien Dua", industry: "retail", entities: [{ name: "PT Dua", shortName: "Dua", kind: "PT", banks: [] }] }));
  const b = await db.$transaction(async (tx) => {
    const firm = await createFirm(tx, "KAP Lain");
    const { client } = await createClient(tx, firm.id, { name: "Klien Lain", industry: "jasa", entities: [{ name: "PT Lain", shortName: "Lain", kind: "PT", banks: [] }] });
    return { firm, client };
  });
  return { a, second: second.client, b };
}

const refusal = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (err: unknown) => err);
  expect(e).toBeInstanceOf(AccessError);
  return (e as AccessError).reason;
};

describe("tenant scope (T03)", () => {
  beforeEach(resetDb);

  it("an admin opens every client of its own organisation and none of another's", async () => {
    const { a, second, b } = await twoOrgs();
    const admin = await member(a.firm.id, "ADMIN");
    const s = (await resolveWorkspace(db, admin.userId))!;
    expect(s.clientIds).toBe("ALL");
    expect(s.access.state).toBe("ACTIVE"); // createFirm gives an open COMP grant
    await checkCapability(db, s, "books.write", { clientId: a.client.id });
    await checkCapability(db, s, "books.write", { clientId: second.id });
    expect(await refusal(checkCapability(db, s, "books.read", { clientId: b.client.id }))).toBe("CLIENT");
    expect((await db.client.findMany({ where: accessibleClientWhere(s) })).map((c) => c.id).sort()).toEqual([a.client.id, second.id].sort());
  });

  it("an akuntan opens only assigned clients; a viewer reads but never writes", async () => {
    const { a, second } = await twoOrgs();
    const akuntan = await member(a.firm.id, "AKUNTAN");
    const viewer = await member(a.firm.id, "VIEWER");
    await db.clientAccess.createMany({ data: [{ memberId: akuntan.id, clientId: a.client.id }, { memberId: viewer.id, clientId: a.client.id }] });
    const s = (await resolveWorkspace(db, akuntan.userId))!;
    expect(s.clientIds).toEqual([a.client.id]);
    await checkCapability(db, s, "books.write", { clientId: a.client.id });
    expect(await refusal(checkCapability(db, s, "books.read", { clientId: second.id }))).toBe("CLIENT");
    expect(await refusal(checkCapability(db, s, "period.unlock", { clientId: a.client.id }))).toBe("ROLE");
    expect((await db.client.findMany({ where: accessibleClientWhere(s) })).map((c) => c.id)).toEqual([a.client.id]);

    const v = (await resolveWorkspace(db, viewer.userId))!;
    await checkCapability(db, v, "books.read", { clientId: a.client.id });
    expect(await refusal(checkCapability(db, v, "books.write", { clientId: a.client.id }))).toBe("ROLE");
  });

  it("a company's members all see its one client without assignments", async () => {
    const { a } = await twoOrgs();
    await db.firm.update({ where: { id: a.firm.id }, data: { kind: "PERUSAHAAN" } });
    const akuntan = await member(a.firm.id, "AKUNTAN");
    const s = (await resolveWorkspace(db, akuntan.userId))!;
    expect(s.clientIds).toBe("ALL");
    await checkCapability(db, s, "books.write", { clientId: a.client.id });
  });

  it("an ended grant reads but refuses writes; a suspended organisation refuses everything; a disabled member has no session", async () => {
    const { a } = await twoOrgs();
    const admin = await member(a.firm.id, "OWNER");
    await db.accessGrant.deleteMany({ where: { firmId: a.firm.id } });
    await db.accessGrant.create({ data: { firmId: a.firm.id, kind: "TRIAL", startsAt: new Date("2026-09-01T00:00:00Z"), endsAt: new Date("2026-09-15T16:59:59.999Z") } });
    const s = (await resolveWorkspace(db, admin.userId, new Date("2026-10-01T00:00:00Z")))!;
    expect(s.access.state).toBe("READ_ONLY");
    await checkCapability(db, s, "books.read", { clientId: a.client.id });
    expect(await refusal(checkCapability(db, s, "books.write", { clientId: a.client.id }))).toBe("READ_ONLY");
    await expect(checkCapability(db, s, "books.write")).rejects.toThrow(/^Masa uji coba berakhir pada 15 Sep 2026\./);

    await db.firm.update({ where: { id: a.firm.id }, data: { suspendedAt: new Date("2026-09-20T00:00:00Z") } });
    const closed = (await resolveWorkspace(db, admin.userId, new Date("2026-10-01T00:00:00Z")))!;
    expect(closed.access.state).toBe("NONE");
    expect(await refusal(checkCapability(db, closed, "books.read"))).toBe("CLOSED");

    await db.firmMember.update({ where: { id: admin.id }, data: { disabled: true } });
    expect(await resolveWorkspace(db, admin.userId)).toBeNull();
    expect(await refusal(checkCapability(db, null, "books.read"))).toBe("SIGNED_OUT");
  });
});
