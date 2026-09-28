import { beforeEach, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { createIntake, hash, json } from "@/lib/evidence/store";
import { askEvidence } from "@/lib/evidence/answers";
import { planRejections } from "@/lib/evidence/plan-stats";
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

it("a confirmed entity-column ledger is out of scope for an entity its column doesn't name", async () => {
  const g = await collection();
  const units = (await db.evidenceVersion.findUniqueOrThrow({ where: { id: g.version.id } })).units as unknown as EvidenceUnit[];
  units[0] = { ...units[0], kind: "LEDGER", role: "SOURCE", table: { mode: "LEDGER", rows: 1, entities: ["PT Uji"], periodStart: null, periodEnd: null } };
  await db.evidenceVersion.update({ where: { id: g.version.id }, data: { units: json(units) } });
  await db.evidenceSelection.create({ data: { firmId: g.firm.id, intakeId: g.intake.id, versionId: g.version.id, unitKey: "PnL", role: "SOURCE", entityId: null, periodStart: "2024-12-01", periodEnd: "2024-12-31", currency: "IDR", confirmed: true } });
  const owner = await askEvidence(db, g.firm.id, g.intake.id, { question: "Penjualan Minuman", entityId: g.owner.entity.id }, null);
  expect(owner.rows?.map((r) => r.source).sort()).toEqual(["Dec23!12", "Dec24!12"]);
  const pt = await askEvidence(db, g.firm.id, g.intake.id, { question: "Penjualan Minuman", entityId: g.pt.entity.id }, null);
  expect(pt.rows?.map((r) => r.source).sort()).toEqual(["Dec23!12", "Dec24!12", "PnL!12"]);
});

it("ignores a planned entity outside the chosen scope instead of failing, and counts rejected plans", async () => {
  const g = await collection();
  const provider = new MockProvider();
  provider.planEvidenceAnswer = async () => ({ plan: { intent: "SEARCH", terms: ["Penjualan"], entityId: g.owner.entity.id }, promptTokens: 1, completionTokens: 1, model: provider.model });
  const answer = await askEvidence(db, g.firm.id, g.intake.id, { question: "Penjualan Minuman PT", entityId: g.pt.entity.id }, provider);
  expect(answer.limitations).toContain("Rencana AI menyebut entitas di luar cakupan yang dipilih; cakupan pilihan Anda yang digunakan.");
  expect(answer.rows?.length).toBeGreaterThan(0);

  provider.planEvidenceAnswer = async () => ({ plan: { intent: "DELETE", terms: [] } as never, promptTokens: 1, completionTokens: 1, model: provider.model });
  const rejected = await askEvidence(db, g.firm.id, g.intake.id, { question: "Hapus semua penjualan" }, provider);
  expect(rejected.limitations).toContain("AI tidak tersedia atau rencana tidak valid; pencarian deterministik digunakan.");
  expect(await planRejections(db, g.firm.id)).toEqual({ days: 30, requested: 2, rejected: 1, rate: 0.5 });
  expect((await db.aiUsage.findFirstOrThrow({ where: { ok: false } })).note).toMatch(/^Rencana jawaban — AI gagal: /);
});

it("a scoped missing-documents question leaves out exceptions known to be outside the scope", async () => {
  const g = await collection();
  const text = "catatan 2023";
  const doc = await db.evidenceDocument.create({ data: { firmId: g.firm.id, intakeId: g.intake.id, sourceKey: "old", name: "tb-2023.xlsx", path: "tb-2023.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", status: "ERROR", issue: "Gagal dibaca ulang" } }); // processed once, then failed: it keeps its last version
  const version = await db.evidenceVersion.create({ data: { firmId: g.firm.id, documentId: doc.id, hash: hash(text), name: doc.name, size: text.length, data: Buffer.from(text), extracted: true, units: json([unit("TB23", "2023-12-31")]) } });
  await db.evidenceDocument.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
  await db.evidenceConflict.create({ data: { firmId: g.firm.id, intakeId: g.intake.id, key: "tb23", kind: "PERIODE", message: "Dua saldo 2023 berbeda", versionIds: json([version.id]) } });
  await db.evidenceConflict.create({ data: { firmId: g.firm.id, intakeId: g.intake.id, key: "pl", kind: "ENTITAS", message: "Entitas belum jelas", versionIds: json([g.version.id]) } });

  const all = await askEvidence(db, g.firm.id, g.intake.id, { question: "Dokumen apa yang kurang?" }, null);
  expect(all.rows?.map((r) => r.label)).toEqual(["tb-2023.xlsx", "PERIODE", "ENTITAS"]);
  // December 2024: the 2023-only file and its conflict are known to be out of scope; the file with an unknown-period sheet stays.
  const dec24 = await askEvidence(db, g.firm.id, g.intake.id, { question: "Dokumen apa yang kurang?", period: "2024-12" }, null);
  expect(dec24.rows?.map((r) => r.label)).toEqual(["ENTITAS"]);

  // A failed file whose kept sheet has no known period stays in, and the note counts it with the collection's own unknown sheet.
  const undated = await db.evidenceDocument.create({ data: { firmId: g.firm.id, intakeId: g.intake.id, sourceKey: "x", name: "lain.xlsx", path: "lain.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", status: "ERROR", issue: "Gagal dibaca ulang" } });
  const undatedVersion = await db.evidenceVersion.create({ data: { firmId: g.firm.id, documentId: undated.id, hash: hash("lain"), name: undated.name, size: 4, data: Buffer.from("lain"), extracted: true, units: json([unit("Lain", null)]) } });
  await db.evidenceDocument.update({ where: { id: undated.id }, data: { currentVersionId: undatedVersion.id } });
  const again = await askEvidence(db, g.firm.id, g.intake.id, { question: "Dokumen apa yang kurang?", period: "2024-12" }, null);
  expect(again.rows?.map((r) => r.label)).toEqual(["lain.xlsx", "ENTITAS"]);
  expect(again.limitations.filter((l) => l.includes("belum dikonfirmasi"))).toEqual(["2 bagian belum dikonfirmasi entitas/periodenya; ikut dicari."]);
});

it("a missing-documents answer looks at the same first 500 documents it scopes", async () => {
  const g = await collection();
  await db.evidenceDocument.createMany({ data: Array.from({ length: 499 }, (_, i) => ({ firmId: g.firm.id, intakeId: g.intake.id, sourceKey: `dir-${i}`, name: `folder ${i}`, path: `folder ${i}`, mimeType: "folder", status: "DIRECTORY" })) });
  // The 501st document: past the limit, so it is neither scoped nor listed.
  const late = await db.evidenceDocument.create({ data: { firmId: g.firm.id, intakeId: g.intake.id, sourceKey: "late", name: "late.xlsx", path: "late.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", status: "ERROR", issue: "Gagal dibaca ulang" } });
  const version = await db.evidenceVersion.create({ data: { firmId: g.firm.id, documentId: late.id, hash: hash("late"), name: late.name, size: 4, data: Buffer.from("late"), extracted: true, units: json([unit("Late", "2023-12-31")]) } });
  await db.evidenceDocument.update({ where: { id: late.id }, data: { currentVersionId: version.id } });
  expect((await db.evidenceDocument.findMany({ where: { intakeId: g.intake.id }, orderBy: { id: "asc" }, select: { id: true } }))[500].id).toBe(late.id);
  const answer = await askEvidence(db, g.firm.id, g.intake.id, { question: "Dokumen apa yang kurang?", period: "2024-12" }, null);
  expect(answer.rows?.map((r) => r.label)).not.toContain("late.xlsx");
  expect(answer.limitations).toContain("Pencarian dibatasi 500 dokumen pertama.");
});

it("says so when there are more open conflicts than a missing-documents answer checks", async () => {
  const g = await collection();
  await db.evidenceConflict.createMany({ data: Array.from({ length: 501 }, (_, i) => ({ firmId: g.firm.id, intakeId: g.intake.id, key: `k${i}`, kind: "PERIODE", message: `Konflik ${i}`, versionIds: json([g.version.id]) })) });
  const answer = await askEvidence(db, g.firm.id, g.intake.id, { question: "Dokumen apa yang kurang?", period: "2024-12" }, null);
  expect(answer.limitations).toContain("Pengecualian terbuka lebih dari 500; hanya 500 pertama yang diperiksa.");
});
