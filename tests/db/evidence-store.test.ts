import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { appendUpload, assertLease, beginUpload, claimStep, createIntake, finishUpload, releaseStep } from "@/lib/evidence/store";
import { CHUNK_LIMIT, FILE_COUNT_LIMIT, FILE_LIMIT, INTAKE_LIMIT } from "@/lib/evidence/config";
import { analyzeVersion } from "@/lib/evidence/enrich";
import { MockProvider, type AiProvider, type EvidenceInput } from "@/lib/ai/provider";

beforeEach(resetDb);
async function setup() {
  const g = await makeGroup();
  const intake = await createIntake(db, g.firm.id, g.client.id);
  return { ...g, intake };
}
async function upload(g: Awaited<ReturnType<typeof setup>>, text: string) {
  const bytes = Buffer.from(text);
  const pending = await beginUpload(db, g.firm.id, g.intake.id, "profile.txt", bytes.length);
  await appendUpload(db, g.firm.id, pending.id, 0, bytes);
  const doc = await finishUpload(db, g.firm.id, pending.id);
  const version = await db.evidenceVersion.findFirstOrThrow({ where: { documentId: doc.id } });
  return { pending, doc, version };
}

describe("evidence upload and leasing", () => {
  it("resumes chunks, recognizes exact retry, and preserves immutable bytes", async () => {
    const g = await setup();
    const pending = await beginUpload(db, g.firm.id, g.intake.id, "../profile.txt", 6);
    expect(await appendUpload(db, g.firm.id, pending.id, 0, Buffer.from("abc"))).toBe(3);
    expect(await appendUpload(db, g.firm.id, pending.id, 0, Buffer.from("abc"))).toBe(3);
    await expect(appendUpload(db, g.firm.id, pending.id, 0, Buffer.from("bad"))).rejects.toThrow("Urutan");
    await expect(finishUpload(db, g.firm.id, pending.id)).rejects.toThrow("belum lengkap");
    expect(await appendUpload(db, g.firm.id, pending.id, 3, Buffer.from("def"))).toBe(6);
    const doc = await finishUpload(db, g.firm.id, pending.id);
    const version = await db.evidenceVersion.findFirstOrThrow({ where: { documentId: doc.id } });
    expect(Buffer.from(version.data).toString()).toBe("abcdef");
    expect(version.size).toBe(6);
    expect(doc.name).not.toContain("/");
    await expect(finishUpload(db, g.firm.id, pending.id)).rejects.toThrow("tidak ditemukan");
    const repeated = await upload(g, "abcdef");
    expect(repeated.doc.id).toBe(doc.id);
    expect(await db.evidenceVersion.count()).toBe(1);
    expect(await db.journalEntry.count()).toBe(0);
  });
  it("rejects foreign firm access and malformed file/chunk bounds", async () => {
    const g = await setup();
    const pending = await beginUpload(db, g.firm.id, g.intake.id, "profile.txt", 3);
    await expect(beginUpload(db, "foreign", g.intake.id, "x", 1)).rejects.toThrow("tidak ditemukan");
    await expect(appendUpload(db, "foreign", pending.id, 0, Buffer.from("abc"))).rejects.toThrow("tidak ditemukan");
    await expect(finishUpload(db, "foreign", pending.id)).rejects.toThrow("tidak ditemukan");
    await expect(claimStep(db, "foreign", g.intake.id)).rejects.toThrow("tidak ditemukan");
    await expect(createIntake(db, "foreign", g.client.id)).rejects.toThrow("Klien");
    await expect(beginUpload(db, g.firm.id, g.intake.id, "x", FILE_LIMIT + 1)).rejects.toThrow("10 MiB");
    await expect(appendUpload(db, g.firm.id, pending.id, 0, Buffer.alloc(CHUNK_LIMIT + 1))).rejects.toThrow("tidak valid");
    await expect(appendUpload(db, g.firm.id, pending.id, 0, Buffer.from("abcd"))).rejects.toThrow("Urutan");
  });
  it("only one worker holds lease; old token cannot release replacement lease", async () => {
    const g = await setup();
    const results = await Promise.all([claimStep(db, g.firm.id, g.intake.id), claimStep(db, g.firm.id, g.intake.id)]);
    const token = results.find(Boolean)!;
    expect(results.filter(Boolean)).toHaveLength(1);
    await releaseStep(db, g.firm.id, g.intake.id, "wrong");
    expect(await claimStep(db, g.firm.id, g.intake.id)).toBeNull();
    await db.evidenceIntake.update({ where: { id: g.intake.id }, data: { leaseUntil: new Date(Date.now() - 1000) } });
    const next = await claimStep(db, g.firm.id, g.intake.id);
    expect(next).not.toBe(token);
    await expect(db.$transaction(tx => assertLease(tx, g.firm.id, g.intake.id, token))).rejects.toThrow("sesi lain");
    await releaseStep(db, g.firm.id, g.intake.id, token);
    expect(await claimStep(db, g.firm.id, g.intake.id)).toBeNull();
    await releaseStep(db, g.firm.id, g.intake.id, next!);
    expect(await claimStep(db, g.firm.id, g.intake.id)).toBeTruthy();
  });
  it("reserves intake bytes across concurrent incomplete uploads", async () => {
    const g = await setup();
    const { version } = await upload(g, "old");
    // Capacity reads stored byte counts; this fixture does not need a 90 MiB allocation.
    await db.evidenceVersion.update({ where: { id: version.id }, data: { size: INTAKE_LIMIT - FILE_LIMIT - CHUNK_LIMIT } });
    const attempts = await Promise.allSettled([beginUpload(db, g.firm.id, g.intake.id, "a.txt", FILE_LIMIT), beginUpload(db, g.firm.id, g.intake.id, "b.txt", FILE_LIMIT)]);
    expect(attempts.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.evidenceUpload.count()).toBe(1);
  });
  it("reserves discovered-file capacity for incomplete uploads", async () => {
    const g = await setup();
    await db.evidenceDocument.createMany({ data: Array.from({ length: FILE_COUNT_LIMIT - 1 }, (_, i) => ({ firmId: g.firm.id, intakeId: g.intake.id, sourceKey: `existing:${i}`, name: `${i}.txt`, path: `${i}.txt`, mimeType: "text/plain" })) });
    const attempts = await Promise.allSettled([beginUpload(db, g.firm.id, g.intake.id, "a.txt", 1), beginUpload(db, g.firm.id, g.intake.id, "b.txt", 1)]);
    expect(attempts.filter(r => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("explicit source-cited AI enrichment", () => {
  async function fixture() {
    const g = await setup();
    const { version } = await upload(g, "Citra Ternak PTE LTD USD agritech");
    await db.evidenceVersion.update({ where: { id: version.id }, data: { extracted: true } });
    await db.evidencePassage.create({ data: { firmId: g.firm.id, versionId: version.id, unitKey: "sheet:profile", locator: "Profil!A1", text: "Citra Ternak PTE LTD USD agritech" } });
    return { ...g, version };
  }
  it("validates custom providers, preserves confirmed facts and caches successful result", async () => {
    const g = await fixture();
    const confirmed = await db.evidenceFact.create({ data: { firmId: g.firm.id, intakeId: g.intake.id, versionId: g.version.id, unitKey: "sheet:profile", locator: "Profil!A1", key: "industry", value: "agritech", status: "CONFIRMED" } });
    const provider: AiProvider = new MockProvider();
    provider.analyzeEvidence = vi.fn(async (input: EvidenceInput) => ({ model: "mock", promptTokens: 30, completionTokens: 20, analysis: { kind: "COMPANY_PROFILE" as const, entity: "Citra Ternak PTE LTD", currency: "USD", periodStart: null, periodEnd: null, facts: [
      { key: "companyName", value: "Citra Ternak PTE LTD", locator: input.passages[0].locator },
      { key: "industry", value: "agritech", locator: input.passages[0].locator },
      { key: "industry", value: "made up", locator: input.passages[0].locator },
      { key: "currency", value: "USD", locator: "evil" },
    ] } }));
    expect(await analyzeVersion(db, g.firm.id, g.intake.id, g.version.id, provider)).toEqual({ facts: 4, cached: false });
    expect(await analyzeVersion(db, g.firm.id, g.intake.id, g.version.id, provider)).toEqual({ facts: 0, cached: true });
    expect(provider.analyzeEvidence).toHaveBeenCalledTimes(1);
    expect(await db.evidenceFact.findUnique({ where: { id: confirmed.id } })).toMatchObject({ status: "CONFIRMED", value: "agritech" });
    expect(await db.evidenceFact.findFirst({ where: { key: "companyName" } })).toMatchObject({ locator: "Profil!A1", unitKey: "sheet:profile", status: "PROPOSED" });
    expect(await db.evidenceFact.count()).toBe(5);
    expect(await db.evidenceFact.findFirst({ where: { key: "documentKind" } })).toMatchObject({ value: "Profil perusahaan (inferensi AI, bukan kutipan)", status: "PROPOSED", locator: "Profil!A1" });
    expect(await db.evidenceFact.findFirst({ where: { key: "entity" } })).toMatchObject({ status: "PROPOSED", locator: "Profil!A1" });
    expect(await db.evidenceFact.findFirst({ where: { key: "currency" } })).toMatchObject({ value: "USD", status: "PROPOSED", locator: "Profil!A1" });
    expect(await db.journalEntry.count()).toBe(0);
    expect(await db.evidenceSelection.count()).toBe(0);
    expect(await db.aiUsage.count()).toBe(1);
  });
  it("AI-disabled and failed requests retain documents without marking analysis complete", async () => {
    const g = await fixture();
    expect(await analyzeVersion(db, g.firm.id, g.intake.id, g.version.id, null)).toMatchObject({ cached: false, facts: 0 });
    expect(await db.aiUsage.count()).toBe(0);
    const provider: AiProvider = new MockProvider();
    provider.analyzeEvidence = vi.fn(async () => { throw new Error("provider failed"); });
    await expect(analyzeVersion(db, g.firm.id, g.intake.id, g.version.id, provider)).rejects.toThrow("provider failed");
    expect(await db.evidenceVersion.findUnique({ where: { id: g.version.id } })).toMatchObject({ analyzed: false });
    expect(await db.evidenceIntake.findUnique({ where: { id: g.intake.id } })).toMatchObject({ leaseToken: null });
    expect(await db.evidenceFact.count()).toBe(0);
    expect(await db.aiUsage.count()).toBe(1);
  });
  it("foreign firm and wrong intake cannot query version or invoke provider", async () => {
    const g = await fixture();
    const other = await createIntake(db, g.firm.id);
    const provider = new MockProvider();
    await expect(analyzeVersion(db, "foreign", g.intake.id, g.version.id, provider)).rejects.toThrow("tidak ditemukan");
    await expect(analyzeVersion(db, g.firm.id, other.id, g.version.id, provider)).rejects.toThrow("Versi dokumen tidak ditemukan");
    expect(provider.calls).toBe(0);
  });
});
