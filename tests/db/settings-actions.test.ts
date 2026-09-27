import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "../helpers";

const session = vi.hoisted(() => ({ role: "ADMIN" as "ADMIN" | "AKUNTAN" | null }));
vi.mock("@/lib/tenant", () => ({ getCurrentFirm: async () => ({ id: "settings-test-firm" }) }));
vi.mock("@/lib/auth/session", () => ({ requireMember: async (role?: string) => {
  if (!session.role) throw new Error("Masuk terlebih dahulu.");
  if (role && session.role !== role) throw new Error("Hanya admin kantor yang dapat mengubah ini.");
  return { id: "member", role: session.role };
} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { saveAiSettingsAction, clearAiKeyAction } = await import("@/app/settings-actions");

describe("Pengaturan actions", () => {
  beforeEach(async () => {
    vi.stubEnv("SETTINGS_SECRET", "test-secret-0123456789abcdefghijklmnop");
    session.role = "ADMIN";
    await resetDb();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refuses an akuntan and writes nothing", async () => {
    session.role = "AKUNTAN";
    const r = await saveAiSettingsAction({ apiKey: "sk-zen-12345678", model: "m" });
    expect(r).toEqual({ ok: false, error: "Hanya admin kantor yang dapat mengubah ini." });
    expect(await clearAiKeyAction()).toMatchObject({ ok: false });
  });

  it("refuses anonymous callers", async () => {
    session.role = null;
    expect(await saveAiSettingsAction({ apiKey: "sk-zen-12345678", model: "m" })).toEqual({ ok: false, error: "Masuk terlebih dahulu." });
  });

  it("saves for an admin and returns only the last 4 characters of the key", async () => {
    const r = await saveAiSettingsAction({ apiKey: "sk-zen-12345678", model: "big-pickle" });
    expect(r).toEqual({ ok: true, keyLast4: "5678" });
    expect(JSON.stringify(r)).not.toContain("sk-zen");
  });
});
