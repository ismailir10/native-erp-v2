import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postOpening } from "@/lib/opening";
import { dateOnly } from "@/lib/format";

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
const { renameEntityAction, updateBankAccountAction, removeBankAccountAction, removeEntityAction } = await import("@/app/actions");

describe("rename and remove actions", () => {
  beforeEach(resetDb);

  it("an akuntan renames and edits, but cannot remove — and nothing is removed", async () => {
    const g = await makeGroup();
    session.firmId = g.firm.id;
    session.role = "AKUNTAN";
    expect(await renameEntityAction(g.client.id, g.pt.entity.id, { name: "PT Nama Baru", shortName: "PT Baru", npwp: "" })).toEqual({ ok: true });
    expect(await updateBankAccountAction(g.client.id, g.pt.banks[1].id, { label: "Mandiri Baru", bank: "MANDIRI", number: "2222222222" })).toEqual({ ok: true });
    expect((await db.entity.findUniqueOrThrow({ where: { id: g.pt.entity.id } })).shortName).toBe("PT Baru");
    const denied = { ok: false, error: "Hanya admin kantor yang dapat mengubah ini." };
    expect(await removeBankAccountAction(g.client.id, g.pt.banks[1].id)).toEqual(denied);
    expect(await removeEntityAction(g.client.id, g.owner.entity.id)).toEqual(denied);
    expect([await db.bankAccount.count(), await db.entity.count()]).toEqual([3, 2]);
  });

  it("an admin removes what is empty and is told why when something has books", async () => {
    const g = await makeGroup();
    session.firmId = g.firm.id;
    session.role = "ADMIN";
    await postOpening(db, { clientId: g.client.id, entityId: g.pt.entity.id, date: dateOnly(2026, 7, 31), lines: [{ accountCode: "1101", debit: "1000000", credit: "0" }] });
    const blocked = await removeBankAccountAction(g.client.id, g.pt.banks[0].id);
    expect(blocked).toMatchObject({ ok: false, error: expect.stringMatching(/^Sudah ada 1 baris jurnal\. Rekening yang sudah dipakai tidak bisa dihapus\.$/) });
    expect(await removeEntityAction(g.client.id, g.pt.entity.id)).toMatchObject({ ok: false, error: expect.stringMatching(/^Sudah ada 1 jurnal \(termasuk saldo awal\)\./) });
    expect(await removeBankAccountAction(g.client.id, g.pt.banks[1].id)).toEqual({ ok: true });
    expect(await removeEntityAction(g.client.id, g.owner.entity.id)).toEqual({ ok: true });
    expect([await db.bankAccount.count(), await db.entity.count()]).toEqual([1, 1]);
    // The last one stays.
    expect(await removeEntityAction(g.client.id, g.pt.entity.id)).toMatchObject({ ok: false });
  });

  it("returns the field messages for a bad rename and refuses another firm's client", async () => {
    const g = await makeGroup(), other = await makeGroup();
    session.firmId = g.firm.id;
    session.role = "ADMIN";
    expect(await renameEntityAction(g.client.id, g.pt.entity.id, { name: "", shortName: "", npwp: "1" })).toMatchObject({ ok: false, error: "Periksa 2 isian yang ditandai.", fields: { name: "Isi nama badan usaha.", npwp: expect.any(String) } });
    expect(await renameEntityAction(other.client.id, other.pt.entity.id, { name: "Diambil", shortName: "X", npwp: "" })).toMatchObject({ ok: false, error: "Klien tidak ditemukan." });
    expect(await removeEntityAction(other.client.id, other.owner.entity.id)).toMatchObject({ ok: false, error: "Klien tidak ditemukan." });
    expect((await db.entity.findUniqueOrThrow({ where: { id: other.pt.entity.id } })).name).toBe("PT Uji Sejahtera");
  });
});
