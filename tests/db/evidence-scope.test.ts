import { beforeEach, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { createIntake, hash, json } from "@/lib/evidence/store";
import { askEvidence } from "@/lib/evidence/answers";
import { MockProvider } from "@/lib/ai/provider";
import type { EvidenceUnit } from "@/lib/evidence/types";

beforeEach(resetDb);

const unit = (key: string, periodEnd: string | null): EvidenceUnit => ({ key, label: key, kind: "REPORT", role: "COMPARISON", entity: null, periodStart: periodEnd, periodEnd, currency: "IDR", scale: "1", passages: [], figures: [], facts: [], issues: [] });

async function collection() {
  const g = await makeGroup(), intake = await createIntake(db, g.firm.id, g.client.id);
  const text = "4 1 01 01 | Penjualan Minuman | 1125635898";
  const doc = await db.evidenceDocument.create({ data: { firmId: g.firm.id, intakeId: intake.id, sourceKey: "pl", name: "pl.xlsx", path: "pl.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", status: "READY" } });
  // Three sheets, none confirmed: no period, a known 2024-12 period, a known 2023-12 period.
  const units = [unit("PnL", null), unit("Dec24", "2024-12-31"), unit("Dec23", "2023-12-31")];
  const version = await db.evidenceVersion.create({ data: { firmId: g.firm.id, documentId: doc.id, hash: hash(text), name: doc.name, size: text.length, data: Buffer.from(text), extracted: true, units: json(units) } });
  await db.evidenceDocument.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
  for (const u of units) await db.evidencePassage.create({ data: { firmId: g.firm.id, versionId: version.id, unitKey: u.key, locator: `${u.key}!12`, text } });
  await db.evidenceFact.create({ data: { firmId: g.firm.id, intakeId: intake.id, versionId: version.id, unitKey: "PnL", locator: "PnL!2", key: "companyName", value: "PT Kopi Contoh" } });
  return { ...g, intake, version };
}

it("dated questions on a collection with nothing confirmed still find unconfirmed evidence and say so", async () => {
  const g = await collection();
  const answer = await askEvidence(db, g.firm.id, g.intake.id, { question: "Penjualan Minuman", period: "2024-12" }, null);
  expect(answer.rows?.map((r) => r.source).sort()).toEqual(["Dec24!12", "PnL!12"]);
  expect(answer.limitations).toContain("1 bagian belum dikonfirmasi entitas/periodenya; ikut dicari.");

  // A date the AI plan extracts scopes the same way as the field.
  const provider = new MockProvider();
  provider.planEvidenceAnswer = async () => ({ plan: { intent: "SEARCH", terms: ["Penjualan"], from: "2024-12-01", to: "2024-12-31" }, promptTokens: 1, completionTokens: 1, model: provider.model });
  const planned = await askEvidence(db, g.firm.id, g.intake.id, { question: "Berapa Penjualan Minuman Desember 2024?" }, provider);
  expect(planned.rows?.map((r) => r.source).sort()).toEqual(["Dec24!12", "PnL!12"]);

  // Company profile shows proposed facts from unconfirmed units.
  const context = await askEvidence(db, g.firm.id, g.intake.id, { question: "Profil perusahaan", period: "2024-12" }, null);
  expect(context.rows?.map((r) => r.value)).toEqual(["PT Kopi Contoh (belum dikonfirmasi)"]);
});

it("units known to be out of scope stay excluded", async () => {
  const g = await collection();
  await db.evidenceSelection.create({ data: { firmId: g.firm.id, intakeId: g.intake.id, versionId: g.version.id, unitKey: "PnL", role: "COMPARISON", entityId: g.owner.entity.id, periodStart: "2024-12-01", periodEnd: "2024-12-31", confirmed: true } });
  const byEntity = await askEvidence(db, g.firm.id, g.intake.id, { question: "Penjualan Minuman", entityId: g.pt.entity.id }, null);
  expect(byEntity.rows?.map((r) => r.source).sort()).toEqual(["Dec23!12", "Dec24!12"]);
  expect(byEntity.limitations).toContain("2 bagian belum dikonfirmasi entitas/periodenya; ikut dicari.");
  await db.evidenceSelection.update({ where: { versionId_unitKey: { versionId: g.version.id, unitKey: "PnL" } }, data: { entityId: g.pt.entity.id, periodStart: "2025-01-01", periodEnd: "2025-01-31" } });
  const byPeriod = await askEvidence(db, g.firm.id, g.intake.id, { question: "Penjualan Minuman", period: "2024-12" }, null);
  expect(byPeriod.rows?.map((r) => r.source)).toEqual(["Dec24!12"]);
  expect(byPeriod.limitations.join(" ")).not.toContain("belum dikonfirmasi");
});
