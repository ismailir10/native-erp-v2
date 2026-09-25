import { afterEach, describe, expect, it, vi } from "vitest";
import { evidenceEnabled, requireEvidenceEnabled } from "@/lib/evidence/config";

afterEach(() => vi.unstubAllEnvs());
describe("evidence workspace switch", () => {
  it("uses the same document capability in both authenticated environments", () => {
    vi.stubEnv("EVIDENCE_ENABLED", "true");
    for (const demo of ["true", "false"]) for (const environment of ["production", "preview"]) {
      vi.stubEnv("DEMO_MODE", demo); vi.stubEnv("VERCEL", "1"); vi.stubEnv("VERCEL_ENV", environment);
      expect(evidenceEnabled()).toBe(true);
      expect(() => requireEvidenceEnabled()).not.toThrow();
    }
    vi.stubEnv("EVIDENCE_ENABLED", "false");
    expect(evidenceEnabled()).toBe(false);
    expect(() => requireEvidenceEnabled()).toThrow(/belum diaktifkan/);
  });
});
