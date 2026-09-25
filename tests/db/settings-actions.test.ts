import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "../helpers";

vi.mock("@/lib/tenant", () => ({ getCurrentFirm: async () => ({ id: "settings-test-firm" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { saveAiSettingsAction, clearAiKeyAction } = await import("@/app/settings-actions");

describe("Pengaturan actions", () => {
  beforeEach(async () => {
    vi.stubEnv("SETTINGS_SECRET", "test-secret-0123456789abcdefghijklmnop");
    vi.stubEnv("ADMIN_PASSCODE", "kopi-tubruk-42");
    await resetDb();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects a wrong passcode and writes nothing", async () => {
    const r = await saveAiSettingsAction({ passcode: "tebak", apiKey: "sk-zen-12345678", model: "m" });
    expect(r).toEqual({ ok: false, error: "Kode admin salah." });
    expect(await clearAiKeyAction({ passcode: "" })).toMatchObject({ ok: false });
  });

  it("is read-only when ADMIN_PASSCODE is unset", async () => {
    vi.stubEnv("ADMIN_PASSCODE", "");
    const r = await saveAiSettingsAction({ passcode: "", apiKey: "sk-zen-12345678", model: "m" });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("ADMIN_PASSCODE") });
  });

  it("saves and returns only the last 4 characters of the key", async () => {
    const r = await saveAiSettingsAction({ passcode: "kopi-tubruk-42", apiKey: "sk-zen-12345678", model: "big-pickle" });
    expect(r).toEqual({ ok: true, keyLast4: "5678" });
    expect(JSON.stringify(r)).not.toContain("sk-zen");
  });
});
