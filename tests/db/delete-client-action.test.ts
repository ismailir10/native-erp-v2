import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { addMember } from "../members";

const auth = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth", () => ({ authConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getClaims: async () => ({ data: auth.userId ? { claims: { sub: auth.userId } } : null }) } }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { deleteClientAction } = await import("@/app/actions");

describe("Hapus klien action", () => {
  beforeEach(resetDb);

  it("refuses an akuntan and deletes nothing; an admin with the exact name deletes", async () => {
    const g = await makeGroup();
    auth.userId = (await addMember(g.firm.id, "AKUNTAN", { clients: [g.client.id] })).userId;
    expect(await deleteClientAction(g.client.id, "Grup Uji")).toEqual({ ok: false, error: "Hanya admin kantor yang dapat menghapus klien." });
    expect(await db.client.count()).toBe(1);
    auth.userId = (await addMember(g.firm.id, "ADMIN")).userId;
    expect(await deleteClientAction(g.client.id, "Grup")).toEqual({ ok: false, error: 'Ketik nama klien persis "Grup Uji" untuk menghapusnya.' });
    expect(await deleteClientAction(g.client.id, "Grup Uji")).toEqual({ ok: true });
    expect(await db.client.count()).toBe(0);
  });
});
