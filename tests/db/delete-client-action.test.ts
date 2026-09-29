import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";

const session = vi.hoisted(() => ({ role: "ADMIN" as "ADMIN" | "AKUNTAN", firmId: "" }));
vi.mock("@/lib/auth/session", () => ({
  requireMember: async (role?: string) => {
    if (role && session.role !== role) throw new Error("Hanya admin kantor yang dapat mengubah ini.");
    return { id: "member", role: session.role };
  },
}));
vi.mock("@/lib/tenant", async () => {
  const { db } = await import("../helpers");
  return {
    getCurrentFirm: async () => ({ id: session.firmId }),
    getCurrentMember: async () => ({ id: "member", role: session.role }),
    getClientForFirm: async (id: string) => {
      const c = await db.client.findFirst({ where: { id, firmId: session.firmId }, include: { entities: { include: { bankAccounts: { include: { account: true } } } } } });
      if (!c) throw new Error("Klien tidak ditemukan");
      return c;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { deleteClientAction } = await import("@/app/actions");

describe("Hapus klien action", () => {
  beforeEach(resetDb);

  it("refuses an akuntan and deletes nothing; an admin with the exact name deletes", async () => {
    const g = await makeGroup();
    session.firmId = g.firm.id;
    session.role = "AKUNTAN";
    expect(await deleteClientAction(g.client.id, "Grup Uji")).toEqual({ ok: false, error: "Hanya admin kantor yang dapat mengubah ini." });
    expect(await db.client.count()).toBe(1);
    session.role = "ADMIN";
    expect(await deleteClientAction(g.client.id, "Grup")).toEqual({ ok: false, error: 'Ketik nama klien persis "Grup Uji" untuk menghapusnya.' });
    expect(await deleteClientAction(g.client.id, "Grup Uji")).toEqual({ ok: true });
    expect(await db.client.count()).toBe(0);
  });
});
