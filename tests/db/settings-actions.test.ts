import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "../helpers";
import { addMember } from "../members";
import { createFirm } from "@/lib/setup";

const auth = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth", () => ({ authConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getClaims: async () => ({ data: auth.userId ? { claims: { sub: auth.userId } } : null }) } }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { saveAiSettingsAction, clearAiKeyAction } = await import("@/app/settings-actions");

const roles = { admin: "", akuntan: "" };

describe("Pengaturan actions", () => {
  beforeEach(async () => {
    vi.stubEnv("SETTINGS_SECRET", "test-secret-0123456789abcdefghijklmnop");
    await resetDb();
    const firm = await db.$transaction((tx) => createFirm(tx, "KAP Pengaturan"));
    roles.admin = (await addMember(firm.id, "ADMIN")).userId;
    roles.akuntan = (await addMember(firm.id, "AKUNTAN")).userId;
    auth.userId = roles.admin;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refuses an akuntan and writes nothing", async () => {
    auth.userId = roles.akuntan;
    const r = await saveAiSettingsAction({ apiKey: "sk-zen-12345678", model: "m" });
    expect(r).toEqual({ ok: false, error: "Hanya admin kantor yang dapat mengubah ini." });
    expect(await clearAiKeyAction()).toMatchObject({ ok: false });
  });

  it("refuses anonymous callers", async () => {
    auth.userId = null;
    expect(await saveAiSettingsAction({ apiKey: "sk-zen-12345678", model: "m" })).toEqual({ ok: false, error: "Masuk terlebih dahulu." });
  });

  it("saves for an admin and returns only the last 4 characters of the key", async () => {
    const r = await saveAiSettingsAction({ apiKey: "sk-zen-12345678", model: "big-pickle" });
    expect(r).toEqual({ ok: true, keyLast4: "5678" });
    expect(JSON.stringify(r)).not.toContain("sk-zen");
  });
});
