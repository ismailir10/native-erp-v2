import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";

const session = vi.hoisted(() => ({ role: "AKUNTAN" as "ADMIN" | "AKUNTAN", firmId: "" }));
vi.mock("@/lib/tenant", async () => {
  const { db } = await import("../helpers");
  return {
    getCurrentFirm: async () => ({ id: session.firmId }),
    getCurrentMember: async () => ({ id: "member", role: session.role }),
    getClientForFirm: async (id: string) => {
      const c = await db.client.findFirst({ where: { id, firmId: session.firmId }, include: { entities: true } });
      if (!c) throw new Error("Klien tidak ditemukan");
      return c;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { saveReportingFrameworkAction } = await import("@/app/actions");

describe("Kerangka pelaporan per entitas", () => {
  beforeEach(resetDb);

  it("saves a valid framework for an entity of the client; wording only, so any member may", async () => {
    const g = await makeGroup();
    session.firmId = g.firm.id;
    expect(await saveReportingFrameworkAction(g.client.id, g.pt.entity.id, "SAK_EMKM")).toEqual({ ok: true });
    expect((await db.entity.findUniqueOrThrow({ where: { id: g.pt.entity.id } })).reportingFramework).toBe("SAK_EMKM");
    expect((await db.entity.findUniqueOrThrow({ where: { id: g.owner.entity.id } })).reportingFramework).toBe("SAK_EP");
  });

  it("refuses an unknown framework, an entity of another client and another firm's client", async () => {
    const g = await makeGroup();
    session.firmId = g.firm.id;
    expect(await saveReportingFrameworkAction(g.client.id, g.pt.entity.id, "IFRS")).toEqual({ ok: false, error: "Pilih kerangka pelaporan." });
    expect(await saveReportingFrameworkAction(g.client.id, "nope", "SAK_UMUM")).toEqual({ ok: false, error: "Entitas tidak ditemukan." });
    session.firmId = "other-firm";
    expect(await saveReportingFrameworkAction(g.client.id, g.pt.entity.id, "SAK_UMUM")).toMatchObject({ ok: false });
    expect((await db.entity.findUniqueOrThrow({ where: { id: g.pt.entity.id } })).reportingFramework).toBe("SAK_EP");
  });
});
