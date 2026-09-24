import { beforeEach, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { createIntake, hash, json } from "@/lib/evidence/store";
import { analyzeVersion } from "@/lib/evidence/enrich";
import { askEvidence } from "@/lib/evidence/answers";
import { MockProvider } from "@/lib/ai/provider";

beforeEach(resetDb);
async function fixture() {
  const g = await makeGroup(), intake = await createIntake(db, g.firm.id, g.client.id);
  const text = "Company name: Citra Ternak PTE LTD";
  const doc = await db.evidenceDocument.create({ data: { firmId: g.firm.id, intakeId: intake.id, sourceKey: "profile", name: "profile.txt", path: "profile.txt", mimeType: "text/plain", status: "READY" } });
  const version = await db.evidenceVersion.create({ data: { firmId: g.firm.id, documentId: doc.id, hash: hash(text), name: "profile.txt", size: text.length, data: Buffer.from(text), extracted: true, units: json([]) } });
  await db.evidenceDocument.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
  await db.evidencePassage.create({ data: { firmId: g.firm.id, versionId: version.id, unitKey: "profile", locator: "baris 1", text } });
  return { ...g, intake, version };
}
it("analysis caches stable content while context or model changes permit explicit reanalysis", async () => {
  const g = await fixture();
  const first = new MockProvider({}, "model1");
  expect((await analyzeVersion(db, g.firm.id, g.intake.id, g.version.id, first)).cached).toBe(false);
  expect((await analyzeVersion(db, g.firm.id, g.intake.id, g.version.id, first)).cached).toBe(true);
  expect(first.calls).toBe(1);
  expect((await db.evidenceIntake.findUniqueOrThrow({ where: { id: g.intake.id } })).contextVersion).toBe(g.intake.contextVersion);
  const second = new MockProvider({}, "model2");
  expect((await analyzeVersion(db, g.firm.id, g.intake.id, g.version.id, second)).cached).toBe(false);
  await db.evidenceIntake.update({ where: { id: g.intake.id }, data: { contextVersion: { increment: 1 } } });
  expect((await analyzeVersion(db, g.firm.id, g.intake.id, g.version.id, second)).cached).toBe(false);
  expect(second.calls).toBe(2);
  expect(await db.evidenceAiCache.count()).toBe(3);
  expect(await db.aiUsage.count()).toBe(3);
});
it("answer plan cache is intake-bound and source truncation is visible without caching final answers", async () => {
  const g = await fixture();
  const provider = new MockProvider();
  const input = { question: "Cari Citra" };
  const first = await askEvidence(db, g.firm.id, g.intake.id, input, provider);
  const second = await askEvidence(db, g.firm.id, g.intake.id, input, provider);
  expect(provider.calls).toBe(1);
  expect(first.citations).toEqual(second.citations);
  expect(await db.evidenceMessage.count()).toBe(2);
  await db.evidenceVersion.update({ where: { id: g.version.id }, data: { issues: json(["Ekstraksi dibatasi; sebagian isi belum diperiksa."]) } });
  const third = await askEvidence(db, g.firm.id, g.intake.id, input, provider);
  expect(provider.calls).toBe(1);
  expect(third.limitations.join(" ")).toContain("melewati batas ekstraksi");
  const other = await createIntake(db, g.firm.id, g.client.id);
  await askEvidence(db, g.firm.id, other.id, input, provider);
  expect(provider.calls).toBe(2);
});
