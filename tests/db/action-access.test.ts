import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { addMember } from "../members";
import { createClient, createFirm } from "@/lib/setup";
import { createUploadLink, resolveUploadLink } from "@/lib/upload-links";

// Server actions through the real guard (ADR 0017 §5): only the login token is faked.
const auth = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth", () => ({ authConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getClaims: async () => ({ data: auth.userId ? { claims: { sub: auth.userId } } : null }) } }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { addClientAction, saveReportingFrameworkAction, unlockAction } = await import("@/app/actions");

/** Replace the organisation's grants with one TRIAL that ended on 15 Sep 2026 (Jakarta). */
async function endTrial(firmId: string) {
  await db.accessGrant.deleteMany({ where: { firmId } });
  await db.accessGrant.create({ data: { firmId, kind: "TRIAL", startsAt: new Date("2026-09-01T00:00:00Z"), endsAt: new Date("2026-09-15T16:59:59.999Z") } });
}

describe("server actions refuse what the session may not do (T04)", () => {
  beforeEach(async () => { await resetDb(); auth.userId = null; });

  it("an ended trial reads but refuses every write with the expiry message", async () => {
    const g = await makeGroup();
    auth.userId = (await addMember(g.firm.id, "OWNER")).userId;
    expect(await saveReportingFrameworkAction(g.client.id, g.pt.entity.id, "SAK_EMKM")).toEqual({ ok: true });
    await endTrial(g.firm.id);
    const refused = await saveReportingFrameworkAction(g.client.id, g.pt.entity.id, "SAK_UMUM");
    expect(refused).toEqual({ ok: false, error: "Masa uji coba berakhir pada 15 Sep 2026. Data tetap tersimpan dan laporan bisa diunduh. Hubungi Buku untuk memperpanjang." });
    expect((await db.entity.findUniqueOrThrow({ where: { id: g.pt.entity.id } })).reportingFramework).toBe("SAK_EMKM");
    expect(await addClientAction({ name: "Klien Baru", industry: "jasa", entities: [] } as never)).toMatchObject({ ok: false, error: expect.stringMatching(/^Masa uji coba berakhir/) });
  });

  it("a viewer writes nothing; an akuntan works only on assigned clients and cannot unlock", async () => {
    const g = await makeGroup();
    const other = await db.$transaction((tx) => createClient(tx, g.firm.id, { name: "Klien Dua", industry: "retail", entities: [{ name: "PT Dua", shortName: "Dua", kind: "PT", banks: [] }] }));
    auth.userId = (await addMember(g.firm.id, "VIEWER", { clients: [g.client.id] })).userId;
    expect(await saveReportingFrameworkAction(g.client.id, g.pt.entity.id, "SAK_EMKM")).toEqual({ ok: false, error: "Peran Peninjau hanya dapat melihat dan mengunduh laporan." });

    auth.userId = (await addMember(g.firm.id, "AKUNTAN", { clients: [g.client.id] })).userId;
    expect(await saveReportingFrameworkAction(g.client.id, g.pt.entity.id, "SAK_EMKM")).toEqual({ ok: true });
    expect(await saveReportingFrameworkAction(other.client.id, other.entities[0].entity.id, "SAK_EMKM")).toEqual({ ok: false, error: "Klien tidak ditemukan" });
    expect(await unlockAction(g.client.id, 2026, 8, "Koreksi faktur")).toEqual({ ok: false, error: "Hanya admin kantor yang dapat membuka kembali periode." });
  });

  it("another organisation's client reads exactly like a missing one", async () => {
    const g = await makeGroup();
    const foreign = await db.$transaction((tx) => createFirm(tx, "KAP Lain"));
    auth.userId = (await addMember(foreign.id, "OWNER")).userId;
    expect(await saveReportingFrameworkAction(g.client.id, g.pt.entity.id, "SAK_EMKM")).toEqual({ ok: false, error: "Klien tidak ditemukan" });
    expect(await saveReportingFrameworkAction("missing", g.pt.entity.id, "SAK_EMKM")).toEqual({ ok: false, error: "Klien tidak ditemukan" });
  });

  it("signed out and closed organisations are refused before anything runs", async () => {
    const g = await makeGroup();
    expect(await saveReportingFrameworkAction(g.client.id, g.pt.entity.id, "SAK_EMKM")).toEqual({ ok: false, error: "Masuk terlebih dahulu." });
    auth.userId = (await addMember(g.firm.id, "OWNER")).userId;
    await db.firm.update({ where: { id: g.firm.id }, data: { suspendedAt: new Date("2026-01-01T00:00:00Z") } });
    expect(await saveReportingFrameworkAction(g.client.id, g.pt.entity.id, "SAK_EMKM")).toEqual({ ok: false, error: "Akses ruang kerja ini ditutup. Hubungi Buku." });
  });

  it("a client upload link stops taking files when its organisation's access ends", async () => {
    vi.stubEnv("EVIDENCE_ENABLED", "true");
    const g = await makeGroup();
    const { token } = await createUploadLink(db, { firmId: g.firm.id, clientId: g.client.id, days: 30 });
    expect(await resolveUploadLink(db, token)).not.toBeNull();
    await endTrial(g.firm.id);
    expect(await resolveUploadLink(db, token)).toBeNull();
    vi.unstubAllEnvs();
  });
});
