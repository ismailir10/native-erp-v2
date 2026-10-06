import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { clientModules } from "@/lib/clients/modules";

// ADR 0014 §2 (I1b): a module shows when the client turned it on or already uses it; a trading client starts with Persediaan.
describe("clientModules", () => {
  beforeEach(resetDb);

  it("nothing on, nothing used: no module shows", async () => {
    const g = await makeGroup();
    expect((await clientModules(db, g.firm.id)).get(g.client.id)).toEqual({ enabled: [], inUse: [], visible: [] });
  });

  it("a module turned on shows; unknown keys are dropped", async () => {
    const g = await makeGroup();
    await db.client.update({ where: { id: g.client.id }, data: { modules: ["leases", "unknown"] } });
    expect((await clientModules(db, g.firm.id)).get(g.client.id)).toEqual({ enabled: ["leases"], inUse: [], visible: ["leases"] });
  });

  it("a module with data shows even when not turned on", async () => {
    const g = await makeGroup();
    await db.inventoryCount.create({ data: { firmId: g.firm.id, clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month: 7, amount: 100n, bookBefore: 0n } });
    expect((await clientModules(db, g.firm.id)).get(g.client.id)).toMatchObject({ enabled: [], inUse: ["inventory"], visible: ["inventory"] });
  });

  it("a trading client starts with Persediaan", async () => {
    const g = await makeGroup();
    await db.client.update({ where: { id: g.client.id }, data: { industry: "Toko bahan bangunan" } });
    expect((await clientModules(db, g.firm.id)).get(g.client.id)?.visible).toEqual(["inventory"]);
  });
});
