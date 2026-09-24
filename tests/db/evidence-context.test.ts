import { beforeEach, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { createIntake, hash, json } from "@/lib/evidence/store";
import { decideFact } from "@/lib/evidence/review";
import { rebuildConflicts } from "@/lib/evidence/jobs";
import { loadWorkspace } from "@/lib/evidence/workspace";
import { askEvidence } from "@/lib/evidence/answers";
import { analyzeVersion } from "@/lib/evidence/enrich";
import { MockProvider, type AiProvider } from "@/lib/ai/provider";
import type { EvidenceUnit } from "@/lib/evidence/types";

beforeEach(resetDb);

it("refresh retains confirmed context, exposes conflicting proposals, and respects source scopes and exclusions", async () => {
  const g = await makeGroup(), intake = await createIntake(db, g.firm.id, g.client.id);
  const doc = await db.evidenceDocument.create({ data: { firmId: g.firm.id, intakeId: intake.id, sourceKey: "profile", name: "profile.txt", path: "profile.txt", mimeType: "text/plain", status: "READY" } });
  const unit: EvidenceUnit = { key: "profile", label: "Profil", kind: "CONTEXT", role: "CONTEXT", entity: g.pt.entity.name, periodStart: "2026-01-01", periodEnd: "2026-01-31", currency: "IDR", scale: "1", passages: [], figures: [], facts: [], issues: [] };
  async function addVersion(value: string) {
    const text = `Industry: ${value}`;
    const version = await db.evidenceVersion.create({ data: { firmId: g.firm.id, documentId: doc.id, hash: hash(text), name: doc.name, size: text.length, data: Buffer.from(text), extracted: true, units: json([unit]) } });
    await db.evidencePassage.create({ data: { firmId: g.firm.id, versionId: version.id, unitKey: unit.key, locator: "baris 1", text } });
    const fact = await db.evidenceFact.create({ data: { firmId: g.firm.id, intakeId: intake.id, versionId: version.id, unitKey: unit.key, locator: "baris 1", key: "industry", value } });
    await db.evidenceSelection.create({ data: { firmId: g.firm.id, intakeId: intake.id, versionId: version.id, unitKey: unit.key, role: "CONTEXT", entityId: g.pt.entity.id, periodStart: unit.periodStart, periodEnd: unit.periodEnd, confirmed: true } });
    await db.evidenceDocument.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
    return { version, fact };
  }
  const old = await addVersion("poultry");
  await decideFact(db, g.firm.id, intake.id, old.fact.id, true);
  await db.evidenceFact.create({ data: { firmId: g.firm.id, intakeId: intake.id, versionId: old.version.id, unitKey: unit.key, locator: "baris 1", key: "stale", value: "old unconfirmed claim" } });
  const current = await addVersion("retail");
  await rebuildConflicts(db, g.firm.id, intake.id);
  const workspace = await loadWorkspace(db, g.firm.id, intake.id);
  expect(workspace.facts).toHaveLength(2);
  expect(workspace.facts.find(f => f.id === old.fact.id)).toMatchObject({ status: "CONFIRMED", sourceWarning: expect.stringContaining("sebelumnya") });
  expect(workspace.facts.find(f => f.id === current.fact.id)).toMatchObject({ status: "CONFLICTING", sourceWarning: null });
  const question = { question: "Profil perusahaan", entityId: g.pt.entity.id, period: "2026-01" };
  const answer = await askEvidence(db, g.firm.id, intake.id, question, null);
  expect(answer.rows?.map(r => r.value)).toEqual(expect.arrayContaining(["poultry (dikonfirmasi; versi sebelumnya)", "retail (bertentangan; belum dikonfirmasi)"]));
  expect(answer.citations).toContainEqual({ versionId: old.version.id, locator: "baris 1", label: "profile.txt" });
  expect(answer.limitations.join(" ")).toContain("versi sebelumnya");
  expect((await askEvidence(db, g.firm.id, intake.id, { ...question, entityId: g.owner.entity.id }, null)).rows).toEqual([]);
  expect((await askEvidence(db, g.firm.id, intake.id, { ...question, period: "2026-02" }, null)).rows).toEqual([]);
  await expect(askEvidence(db, "foreign-firm", intake.id, question, null)).rejects.toThrow();
  await db.evidenceDocument.update({ where: { id: doc.id }, data: { excluded: true } });
  expect((await loadWorkspace(db, g.firm.id, intake.id)).facts).toEqual([]);
  expect((await askEvidence(db, g.firm.id, intake.id, question, null)).rows).toEqual([]);
  expect((await db.evidenceFact.findUniqueOrThrow({ where: { id: old.fact.id } })).status).toBe("CONFIRMED");
  expect(await db.journalEntry.count()).toBe(0);
});

it("AI enrichment context includes historic confirmations but omits explicitly excluded sources", async () => {
  const g = await makeGroup(), intake = await createIntake(db, g.firm.id, g.client.id);
  async function source(key: string, excluded: boolean) {
    const doc = await db.evidenceDocument.create({ data: { firmId: g.firm.id, intakeId: intake.id, sourceKey: key, name: `${key}.txt`, path: key, mimeType: "text/plain", status: "READY", excluded } });
    const version = await db.evidenceVersion.create({ data: { firmId: g.firm.id, documentId: doc.id, hash: hash(key), name: doc.name, size: key.length, data: Buffer.from(key), extracted: true } });
    await db.evidenceFact.create({ data: { firmId: g.firm.id, intakeId: intake.id, versionId: version.id, unitKey: "text", locator: "baris 1", key: "industry", value: key, status: "CONFIRMED" } });
    await db.evidencePassage.create({ data: { firmId: g.firm.id, versionId: version.id, unitKey: "text", locator: "baris 1", text: key } });
    return version;
  }
  const included = await source("retained historical context", false);
  await source("excluded company context", true);
  const provider: AiProvider = new MockProvider();
  let sentContext = "";
  const original = provider.analyzeEvidence!.bind(provider);
  provider.analyzeEvidence = async input => { sentContext = input.context; return original(input); };
  await analyzeVersion(db, g.firm.id, intake.id, included.id, provider);
  expect(sentContext).toContain("retained historical context");
  expect(sentContext).not.toContain("excluded company context");
});
