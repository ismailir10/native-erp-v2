import { afterEach, describe, expect, it, vi } from "vitest";
import { evidenceEnabled, requireEvidenceEnabled } from "@/lib/evidence/config";
import { loadPublicEvidenceDemo } from "@/lib/demo/evidence-sources";
import { answerPublicEvidence, demoSourceAnchor } from "@/lib/demo/evidence-answers";

afterEach(() => vi.unstubAllEnvs());
describe("public evidence boundary", () => {
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
  it("compares extracted source amounts exactly and links each citation to an existing passage", async () => {
    const sources = await loadPublicEvidenceDemo();
    const answer = answerPublicEvidence(sources, "Bandingkan pendapatan");
    expect(answer.text).toContain("US$ 250,00");
    expect(answer.rows).toHaveLength(2);
    expect(answer.citations).toHaveLength(2);
    for (const citation of answer.citations) expect(sources.some(s => s.units.some(u => u.passages.some(p => citation.href === `/documents#${demoSourceAnchor(s.id, p.locator)}`)))).toBe(true);
    expect(answer.limitation).toContain("bukan saldo buku");
    expect(answerPublicEvidence(sources, "Bandingkan laba bersih").text).toContain("US$ 100,00");
    expect(answerPublicEvidence(sources, "Apa profil perusahaan?").rows.some(r => r.value.includes("distribusi pakan"))).toBe(true);
    expect(answerPublicEvidence(sources, "Cari pendapatan").rows).toHaveLength(2);
    expect(answerPublicEvidence(sources, "Tampilkan transaksi").limitation).toContain("tidak dapat disimpulkan");
  });
});
