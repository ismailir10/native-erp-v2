"use server";
import { prisma } from "@/lib/db";
import { getCurrentFirm } from "@/lib/tenant";
import { requireEvidenceEnabled } from "@/lib/evidence/config";
import { appendUpload, beginUpload, createIntake, finishUpload, intakeForFirm, lockIntake } from "@/lib/evidence/store";
import { attachDrive, includeDocument, processStep, rebuildConflicts } from "@/lib/evidence/jobs";
import { loadWorkspace } from "@/lib/evidence/workspace";
import { confirmSelection, createClientFromEvidence, decideFact, linkClient, postEvidenceBank, prepareImport, resolveConflict, type SelectionInput } from "@/lib/evidence/review";
import { analyzeVersion } from "@/lib/evidence/enrich";
import { askEvidence } from "@/lib/evidence/answers";
import { resolveAiConfig } from "@/lib/settings/ai";
import { OpenAiCompatibleProvider } from "@/lib/ai/provider";
import type { NewClientInput } from "@/lib/onboarding";

async function firm() { requireEvidenceEnabled(); return (await getCurrentFirm()).id; }
async function provider() { const cfg = await resolveAiConfig(prisma); return cfg.apiKey && cfg.model ? new OpenAiCompatibleProvider(cfg) : null; }
async function result<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try { return { ok: true, data: await fn() }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Proses gagal. Coba kembali." }; }
}
export async function createEvidenceAction(clientId?: string) {
  return result(async () => ({ id: (await createIntake(prisma, await firm(), clientId)).id }));
}
export async function loadEvidenceAction(intakeId: string) { return result(async () => loadWorkspace(prisma, await firm(), intakeId)); }
export async function beginEvidenceUploadAction(intakeId: string, name: string, size: number) {
  return result(async () => ({ id: (await beginUpload(prisma, await firm(), intakeId, name, size)).id }));
}
export async function appendEvidenceUploadAction(uploadId: string, offset: number, form: FormData) {
  return result(async () => {
    const firmId = await firm(); const chunk = form.get("chunk");
    if (!(chunk instanceof Blob) || chunk.size > 1024 * 1024) throw new Error("Bagian unggahan tidak valid.");
    return appendUpload(prisma, firmId, uploadId, offset, Buffer.from(await chunk.arrayBuffer()));
  });
}
export async function finishEvidenceUploadAction(uploadId: string) { return result(async () => ({ id: (await finishUpload(prisma, await firm(), uploadId)).id })); }
export async function processEvidenceAction(intakeId: string, password?: string, documentId?: string) { return result(async () => processStep(prisma, await firm(), intakeId, password, documentId)); }
export async function attachDriveAction(intakeId: string, url: string) { return result(async () => { await attachDrive(prisma, await firm(), intakeId, url); }); }
export async function includeEvidenceAction(intakeId: string, documentId: string) { return result(async () => includeDocument(prisma, await firm(), intakeId, documentId)); }
export async function excludeEvidenceAction(intakeId: string, documentId: string) {
  return result(async () => { const firmId = await firm();
    await prisma.$transaction(async tx => {
      await lockIntake(tx, intakeId);
      const intake = await intakeForFirm(tx, firmId, intakeId);
      if (intake.leaseUntil && intake.leaseUntil > new Date()) throw new Error("Proses masih berjalan. Tunggu sebelum mengubah sumber.");
      const doc = await tx.evidenceDocument.findFirst({ where: { id: documentId, firmId, intakeId } });
      if (!doc || doc.status === "DIRECTORY") throw new Error("Pilih file di dalam folder untuk dikeluarkan.");
      await tx.evidenceDocument.updateMany({ where: { id: documentId, firmId, intakeId }, data: { excluded: true } });
      await tx.evidenceIntake.update({ where: { id: intakeId }, data: { contextVersion: { increment: 1 } } });
    });
    await rebuildConflicts(prisma, firmId, intakeId);
  });
}
export async function confirmEvidenceAction(intakeId: string, versionId: string, unitKey: string, input: SelectionInput) {
  return result(async () => confirmSelection(prisma, await firm(), intakeId, versionId, unitKey, input));
}
export async function decideEvidenceFactAction(intakeId: string, factId: string, accept: boolean) { return result(async () => decideFact(prisma, await firm(), intakeId, factId, accept)); }
export async function resolveEvidenceConflictAction(intakeId: string, conflictId: string, note: string) { return result(async () => resolveConflict(prisma, await firm(), intakeId, conflictId, note)); }
export async function createEvidenceClientAction(intakeId: string, input: NewClientInput) { return result(async () => createClientFromEvidence(prisma, await firm(), intakeId, input)); }
export async function linkEvidenceClientAction(intakeId: string, clientId: string) { return result(async () => linkClient(prisma, await firm(), intakeId, clientId)); }
export async function analyzeEvidenceAction(intakeId: string, versionId: string) { return result(async () => analyzeVersion(prisma, await firm(), intakeId, versionId, await provider())); }
export async function askEvidenceAction(intakeId: string, question: string, entityId?: string, period?: string) { return result(async () => askEvidence(prisma, await firm(), intakeId, { question, entityId, period }, await provider())); }
export async function prepareEvidenceImportAction(intakeId: string, versionId: string, unitKey: string, bankAccountId?: string, password?: string, currencyMode?: string) { return result(async () => prepareImport(prisma, await firm(), intakeId, versionId, unitKey, bankAccountId, password, currencyMode === "CONVERT" ? "CONVERT" : "FUNCTIONAL")); }
export async function postEvidenceBankAction(intakeId: string, versionId: string, unitKey: string, bankAccountId: string, password?: string) { return result(async () => postEvidenceBank(prisma, await firm(), intakeId, versionId, unitKey, bankAccountId, password)); }
