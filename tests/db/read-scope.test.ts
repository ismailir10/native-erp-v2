import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { addMember } from "../members";
import { createClient } from "@/lib/setup";
import { accessibleClientWhere, intakeVisibleWhere, resolveWorkspace, workspaceAccess } from "@/lib/auth/session";
import { askWorkspace, getWorkspaceOverview, resolveWorkspaceScope, WorkspaceInputError } from "@/lib/workspace";
import { createIntake } from "@/lib/evidence/store";

/** Two clients in one firm; the akuntan is assigned only to the first. */
async function setup() {
  const g = await makeGroup();
  const two = await db.$transaction((tx) => createClient(tx, g.firm.id, { name: "Klien Dua", industry: "retail", entities: [{ name: "PT Dua", shortName: "Dua", kind: "PT", banks: [] }] }));
  const akuntan = await addMember(g.firm.id, "AKUNTAN", { clients: [g.client.id] });
  const session = (await resolveWorkspace(db, akuntan.userId))!;
  return { g, two: two.client, session };
}

describe("read paths list only the member's clients (T05)", () => {
  beforeEach(resetDb);

  it("sidebar, Beranda, work board and reports (one overview) show only assigned clients", async () => {
    const { g, two, session } = await setup();
    expect((await db.client.findMany({ where: accessibleClientWhere(session) })).map((c) => c.name)).toEqual(["Grup Uji"]);
    const overview = await getWorkspaceOverview(db, workspaceAccess(session));
    expect(overview.clients.map((c) => c.name)).toEqual(["Grup Uji"]);
    expect(overview.scope.clientIds).toEqual([g.client.id]);
    await expect(resolveWorkspaceScope(db, workspaceAccess(session), { scope: `client:${two.id}` })).rejects.toBeInstanceOf(WorkspaceInputError);
    // An admin of the same firm sees both.
    const admin = (await resolveWorkspace(db, (await addMember(g.firm.id, "ADMIN")).userId))!;
    expect((await getWorkspaceOverview(db, workspaceAccess(admin))).clients.map((c) => c.name).sort()).toEqual(["Grup Uji", "Klien Dua"]);
  });

  it("the question box answers from assigned clients only", async () => {
    const { two, session } = await setup();
    await expect(askWorkspace(db, workspaceAccess(session), { question: "Apa yang perlu dikerjakan?", scope: `client:${two.id}` })).rejects.toBeInstanceOf(WorkspaceInputError);
    const answer = await askWorkspace(db, workspaceAccess(session), { question: "Apa yang perlu dikerjakan?" });
    expect(JSON.stringify(answer)).not.toContain("Klien Dua");
  });

  it("documents: the firm's unlinked intakes and the assigned client's, never another client's", async () => {
    const { g, two, session } = await setup();
    const inbox = await createIntake(db, g.firm.id);
    const own = await createIntake(db, g.firm.id, g.client.id);
    const hidden = await createIntake(db, g.firm.id, two.id);
    const visible = await db.evidenceIntake.findMany({ where: { firmId: g.firm.id, ...intakeVisibleWhere(session) }, select: { id: true } });
    expect(visible.map((i) => i.id).sort()).toEqual([inbox.id, own.id].sort());
    expect(visible.map((i) => i.id)).not.toContain(hidden.id);
  });
});
