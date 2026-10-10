import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { addMember } from "../members";
import { createFirm } from "@/lib/setup";

const auth = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth", () => ({ authConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getClaims: async () => ({ data: auth.userId ? { claims: { sub: auth.userId } } : null }) } }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { saveReportingFrameworkAction } = await import("@/app/actions");

describe("Kerangka pelaporan per entitas", () => {
  beforeEach(resetDb);

  it("saves a valid framework for an entity of the client; wording only, so any member may", async () => {
    const g = await makeGroup();
    auth.userId = (await addMember(g.firm.id, "AKUNTAN", { clients: [g.client.id] })).userId;
    expect(await saveReportingFrameworkAction(g.client.id, g.pt.entity.id, "SAK_EMKM")).toEqual({ ok: true });
    expect((await db.entity.findUniqueOrThrow({ where: { id: g.pt.entity.id } })).reportingFramework).toBe("SAK_EMKM");
    expect((await db.entity.findUniqueOrThrow({ where: { id: g.owner.entity.id } })).reportingFramework).toBe("SAK_EP");
  });

  it("refuses an unknown framework, an entity of another client and another firm's client", async () => {
    const g = await makeGroup();
    auth.userId = (await addMember(g.firm.id, "AKUNTAN", { clients: [g.client.id] })).userId;
    expect(await saveReportingFrameworkAction(g.client.id, g.pt.entity.id, "IFRS")).toEqual({ ok: false, error: "Pilih kerangka pelaporan." });
    expect(await saveReportingFrameworkAction(g.client.id, "nope", "SAK_UMUM")).toEqual({ ok: false, error: "Entitas tidak ditemukan." });
    const other = await db.$transaction((tx) => createFirm(tx, "KAP Lain"));
    auth.userId = (await addMember(other.id, "ADMIN")).userId;
    expect(await saveReportingFrameworkAction(g.client.id, g.pt.entity.id, "SAK_UMUM")).toMatchObject({ ok: false });
    expect((await db.entity.findUniqueOrThrow({ where: { id: g.pt.entity.id } })).reportingFramework).toBe("SAK_EP");
  });
});
