"use server";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { userMessage } from "@/lib/errors/user-message";
import type { Capability } from "@/lib/auth/permissions";
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

/** Evidence on, organisation open (and writable for a change), and the named client the member's (ADR 0017). Returns the firm id. */
async function firm(capability: Capability = "books.write", clientId?: string) {
  requireEvidenceEnabled();
  return (await requireCapability(capability, clientId ? { clientId } : {})).firm.id;
}
/** As `firm`, for an intake: one linked to a client is the member's only when that client is. Unlinked intakes are the firm's. */
async function intakeFirm(intakeId: string, capability: Capability = "books.write") {
  const firmId = await firm(capability);
  const intake = await prisma.evidenceIntake.findFirst({ where: { id: intakeId, firmId }, select: { clientId: true } });
  if (intake?.clientId) await requireCapability(capability, { clientId: intake.clientId });
  return firmId;
}
async function uploadFirm(uploadId: string) {
  const firmId = await firm("books.write");
  const upload = await prisma.evidenceUpload.findFirst({ where: { id: uploadId, firmId }, select: { intakeId: true } });
  return upload ? intakeFirm(upload.intakeId) : firmId;
}
async function memberId() { return (await requireCapability("books.write")).member.id; }
async function provider() { const cfg = await resolveAiConfig(prisma); return cfg.apiKey && cfg.model ? new OpenAiCompatibleProvider(cfg) : null; }
/**
 * The evidence modules refuse in Bahasa with plain Errors, shown as they are. A database or provider error (it carries a `code`) never
 * reaches the screen: it is logged with a reference and replaced by a Bahasa message (T17 handoff).
 */
async function result<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try { return { ok: true, data: await fn() }; }
  catch (error) { return { ok: false, error: error instanceof Error && !("code" in error) ? error.message : userMessage(error, "Proses gagal. Coba kembali.") }; }
}
export async function createEvidenceAction(clientId?: string) {
  return result(async () => ({ id: (await createIntake(prisma, await firm("books.write", clientId), clientId)).id }));
}
export async function loadEvidenceAction(intakeId: string) { return result(async () => loadWorkspace(prisma, await intakeFirm(intakeId, "books.read"), intakeId)); }
export async function beginEvidenceUploadAction(intakeId: string, name: string, size: number) {
  return result(async () => ({ id: (await beginUpload(prisma, await intakeFirm(intakeId), intakeId, name, size)).id }));
}
export async function appendEvidenceUploadAction(uploadId: string, offset: number, form: FormData) {
  return result(async () => {
    const firmId = await uploadFirm(uploadId); const chunk = form.get("chunk");
    if (!(chunk instanceof Blob) || chunk.size > 1024 * 1024) throw new Error("Bagian unggahan tidak valid.");
    return appendUpload(prisma, firmId, uploadId, offset, Buffer.from(await chunk.arrayBuffer()));
  });
}
export async function finishEvidenceUploadAction(uploadId: string) { return result(async () => ({ id: (await finishUpload(prisma, await uploadFirm(uploadId), uploadId)).id })); }
export async function processEvidenceAction(intakeId: string, password?: string, documentId?: string) { return result(async () => processStep(prisma, await intakeFirm(intakeId), intakeId, password, documentId)); }
export async function attachDriveAction(intakeId: string, url: string) { return result(async () => { await attachDrive(prisma, await intakeFirm(intakeId), intakeId, url); }); }
export async function includeEvidenceAction(intakeId: string, documentId: string) { return result(async () => includeDocument(prisma, await intakeFirm(intakeId), intakeId, documentId)); }
export async function excludeEvidenceAction(intakeId: string, documentId: string) {
  return result(async () => { const firmId = await intakeFirm(intakeId);
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
  return result(async () => confirmSelection(prisma, await intakeFirm(intakeId), intakeId, versionId, unitKey, input));
}
export async function decideEvidenceFactAction(intakeId: string, factId: string, accept: boolean) { return result(async () => decideFact(prisma, await intakeFirm(intakeId), intakeId, factId, accept)); }
export async function resolveEvidenceConflictAction(intakeId: string, conflictId: string, note: string) { return result(async () => resolveConflict(prisma, await intakeFirm(intakeId), intakeId, conflictId, note)); }
export async function createEvidenceClientAction(intakeId: string, input: NewClientInput) { return result(async () => createClientFromEvidence(prisma, await intakeFirm(intakeId), intakeId, input, (await requireCapability("client.create")).member)); }
export async function linkEvidenceClientAction(intakeId: string, clientId: string) { return result(async () => linkClient(prisma, await intakeFirm(intakeId), intakeId, (await requireCapability("books.write", { clientId }), clientId))); }
export async function analyzeEvidenceAction(intakeId: string, versionId: string) { return result(async () => analyzeVersion(prisma, await intakeFirm(intakeId), intakeId, versionId, await provider())); }
export async function askEvidenceAction(intakeId: string, question: string, entityId?: string, period?: string) { return result(async () => askEvidence(prisma, await intakeFirm(intakeId), intakeId, { question, entityId, period }, await provider())); }
export async function prepareEvidenceImportAction(intakeId: string, versionId: string, unitKey: string, bankAccountId?: string, password?: string, currencyMode?: string) { return result(async () => prepareImport(prisma, await intakeFirm(intakeId), intakeId, versionId, unitKey, bankAccountId, password, currencyMode === "CONVERT" ? "CONVERT" : "FUNCTIONAL", await memberId())); }
export async function postEvidenceBankAction(intakeId: string, versionId: string, unitKey: string, bankAccountId: string, password?: string) { return result(async () => postEvidenceBank(prisma, await intakeFirm(intakeId), intakeId, versionId, unitKey, bankAccountId, password, await memberId())); }
