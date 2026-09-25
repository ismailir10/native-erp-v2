import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ firm: vi.fn(), seed: vi.fn(), models: vi.fn(), config: vi.fn(), save: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ getCurrentFirm: mocks.firm, getClientForFirm: mocks.firm }));
vi.mock("@/lib/demo/seed", () => ({ seedDemo: mocks.seed, liveUploadFile: vi.fn() }));
vi.mock("@/lib/settings/ai", () => ({ resolveAiConfig: mocks.config, fetchModels: mocks.models, saveAiSettings: mocks.save, clearAiKey: vi.fn(), validateAiInput: vi.fn(), SettingsError: class extends Error {} }));
vi.mock("@/lib/settings/secret", () => ({ adminPasscodeConfigured: () => true, passcodeMatches: () => true, settingsSecretConfigured: () => true }));
vi.mock("@/lib/evidence/store", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/evidence/store")>(), createIntake: mocks.create }));
import { resetDemoAction } from "@/app/actions";
import { listModelsAction, saveAiSettingsAction } from "@/app/settings-actions";
import { createEvidenceAction } from "@/app/evidence-actions";

beforeEach(() => { vi.clearAllMocks(); mocks.firm.mockRejectedValue(new Error("Masuk terlebih dahulu.")); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe("direct workspace action authorization", () => {
  it("denies credential reads and writes before resolving keys or making external calls", async () => {
    expect((await listModelsAction()).ok).toBe(false);
    expect((await saveAiSettingsAction({ passcode: "valid", apiKey: "test", model: "mock" })).ok).toBe(false);
    expect(mocks.config).not.toHaveBeenCalled(); expect(mocks.models).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("denies document creation outside an authenticated session", async () => {
    vi.stubEnv("EVIDENCE_ENABLED", "true");
    expect((await createEvidenceAction()).ok).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("never exposes whole-database reset to anonymous or invited users", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    await expect(resetDemoAction()).rejects.toThrow("Masuk terlebih dahulu");
    mocks.firm.mockResolvedValue({ id: "firm" });
    expect((await resetDemoAction()).ok).toBe(false);
    expect(mocks.seed).not.toHaveBeenCalled();
  });
});
