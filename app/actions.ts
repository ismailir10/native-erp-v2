"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getClientForFirm, getCurrentFirm } from "@/lib/tenant";
import { importStatement, type ImportSummary } from "@/lib/import/pipeline";
import { resolveProvider } from "@/lib/settings/ai";
import { acceptSimilar, reviewTransaction } from "@/lib/review";
import { CloseError, lockPeriod } from "@/lib/controls";
import { LedgerError } from "@/lib/ledger/post";
import { postAdjustment } from "@/lib/ledger/adjustment";
import { ParseError } from "@/lib/import/types";
import { PdfPasswordError } from "@/lib/import/parsers/pdf";
import { MoneyError } from "@/lib/money";
import { dateOnly } from "@/lib/format";
import { liveUploadFile } from "@/lib/demo/seed";
import { addClient, OnboardingError, type NewClientInput } from "@/lib/onboarding";
import { OpeningError, postOpening, type OpeningLineInput } from "@/lib/opening";
import type { TaxTag } from "@/lib/generated/prisma/enums";
import { RateError, upsertRate, validateRateInput } from "@/lib/fx/rates";
import { postRevaluation, RevaluationError } from "@/lib/fx/revalue";
import { acceptCheck, LedgerImportError, postImport, stageImport } from "@/lib/ledger-import/post";
import { acceptMappings, MappingError, suggestMappings } from "@/lib/ledger-import/mapping";
import type { FsLine } from "@/lib/coa/template";
import type { MapMethod } from "@/lib/generated/prisma/enums";

/**
 * Server actions — the only write path from the UI. Each returns {ok, …} or {ok:false, error}
 * with a Bahasa message the UI shows verbatim. Domain errors are expected; others are bugs.
 */
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; needsPassword?: boolean; fields?: Record<string, string> };

function fail(e: unknown): { ok: false; error: string; needsPassword?: boolean } {
  if (e instanceof PdfPasswordError) return { ok: false, error: e.message, needsPassword: true };
  if (e instanceof ParseError || e instanceof LedgerError || e instanceof CloseError || e instanceof OpeningError || e instanceof MoneyError || e instanceof RateError || e instanceof RevaluationError || e instanceof LedgerImportError || e instanceof MappingError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Terjadi kesalahan tak terduga. Coba lagi." };
}

const MAX_UPLOAD = 5 * 1024 * 1024;

export async function importAction(formData: FormData): Promise<Result<{ summary: ImportSummary }>> {
  try {
    const clientId = String(formData.get("clientId"));
    const bankAccountId = String(formData.get("bankAccountId"));
    const file = formData.get("file");
    const password = String(formData.get("password") ?? "") || undefined; // used once to open the PDF, never stored
    const client = await getClientForFirm(clientId);
    if (!client.entities.some((e) => e.bankAccounts.some((b) => b.id === bankAccountId))) return { ok: false, error: "Pilih rekening bank dulu." };
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Pilih file rekening koran (PDF, CSV, atau XLSX)." };
    if (file.size > MAX_UPLOAD) return { ok: false, error: "File terlalu besar (maks. 5 MB)." };
    const summary = await importStatement(prisma, { bankAccountId, fileName: file.name, data: Buffer.from(await file.arrayBuffer()), provider: await resolveProvider(prisma), password });
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, summary };
  } catch (e) {
    return fail(e);
  }
}

/** Demo shortcut: import the held-back statement without hunting for the file. */
export async function importSampleAction(clientId: string, bankAccountId: string): Promise<Result<{ summary: ImportSummary }>> {
  try {
    const client = await getClientForFirm(clientId);
    if (!client.entities.some((e) => e.bankAccounts.some((b) => b.id === bankAccountId))) return { ok: false, error: "Rekening tidak ditemukan." };
    const f = await liveUploadFile();
    const summary = await importStatement(prisma, { bankAccountId, fileName: f.fileName, data: f.data, provider: await resolveProvider(prisma) });
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, summary };
  } catch (e) {
    return fail(e);
  }
}

async function assertTxInFirm(bankTxId: string) {
  const t = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: bankTxId }, include: { bankAccount: { include: { entity: true } } } });
  await getClientForFirm(t.bankAccount.entity.clientId);
  return t.bankAccount.entity.clientId;
}

export async function reviewAction(input: { bankTxId: string; accountCode: string; taxTag: TaxTag | null; createRule?: boolean }): Promise<Result> {
  try {
    const clientId = await assertTxInFirm(input.bankTxId);
    await reviewTransaction(prisma, input);
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function acceptSimilarAction(bankTxId: string, scope: { entityIds: string[]; period: string }): Promise<Result<{ count: number }>> {
  try {
    const clientId = await assertTxInFirm(bankTxId);
    const client = await getClientForFirm(clientId);
    const source = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: bankTxId } });
    if (!scope || !/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(scope.period) || !scope.entityIds.length || scope.entityIds.some(id => !client.entities.some(e => e.id === id)) || !scope.entityIds.includes(source.entityId)) return { ok: false, error: "Cakupan review tidak valid. Muat ulang halaman." };
    const through = new Date(Date.UTC(Number(scope.period.slice(0, 4)), Number(scope.period.slice(5)), 0));
    if (source.date > through) return { ok: false, error: "Transaksi berada di luar periode review." };
    const count = await acceptSimilar(prisma, bankTxId, { entityIds: scope.entityIds, through });
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, count };
  } catch (e) {
    return fail(e);
  }
}

async function periodFor(clientId: string, year: number, month: number, opts: { mustBeOpen?: boolean } = {}) {
  const client = await getClientForFirm(clientId);
  const period = await prisma.period.upsert({
    where: { clientId_year_month: { clientId, year, month } },
    create: { firmId: client.firmId, clientId, year, month },
    update: {},
  });
  if (opts.mustBeOpen && period.status === "LOCKED") throw new CloseError("Periode sudah ditutup. Buka kembali dulu untuk mengubah.");
  return period;
}

export async function ackControlAction(clientId: string, year: number, month: number, controlKey: string, note: string): Promise<Result> {
  try {
    if (note.trim().length < 5) return { ok: false, error: "Tulis catatan singkat (min. 5 karakter)." };
    const period = await periodFor(clientId, year, month, { mustBeOpen: true });
    await prisma.controlAck.upsert({ where: { periodId_controlKey: { periodId: period.id, controlKey } }, create: { periodId: period.id, controlKey, note }, update: { note } });
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function signoffAction(clientId: string, year: number, month: number, key: string, done: boolean): Promise<Result> {
  try {
    const period = await periodFor(clientId, year, month, { mustBeOpen: true });
    if (done) await prisma.closeSignoff.upsert({ where: { periodId_key: { periodId: period.id, key } }, create: { periodId: period.id, key }, update: {} });
    else await prisma.closeSignoff.deleteMany({ where: { periodId: period.id, key } });
    revalidatePath(`/clients/${clientId}/close`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function lockAction(clientId: string, year: number, month: number): Promise<Result> {
  try {
    await getClientForFirm(clientId);
    await lockPeriod(prisma, clientId, year, month, "Ditutup dari halaman Tutup Buku");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function unlockAction(clientId: string, year: number, month: number): Promise<Result> {
  try {
    const period = await periodFor(clientId, year, month);
    await prisma.period.update({ where: { id: period.id }, data: { status: "OPEN", lockedAt: null } });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function adjustmentAction(input: {
  clientId: string;
  entityId: string;
  date: string;
  memo: string;
  lines: { accountCode: string; debit: string; credit: string }[];
}): Promise<Result<{ entryId: string }>> {
  try {
    const client = await getClientForFirm(input.clientId);
    const entry = await postAdjustment(prisma, { clientId: client.id, entityId: input.entityId, date: new Date(`${input.date}T00:00:00Z`), memo: input.memo, lines: input.lines });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true, entryId: entry.id };
  } catch (e) {
    return fail(e);
  }
}

export async function addClientAction(input: NewClientInput): Promise<Result<{ clientId: string }>> {
  try {
    const firm = await getCurrentFirm();
    const client = await addClient(prisma, firm.id, input);
    revalidatePath("/", "layout");
    return { ok: true, clientId: client.id };
  } catch (e) {
    if (e instanceof OnboardingError) return { ok: false, error: e.message, fields: e.fields };
    return fail(e);
  }
}

export async function openingAction(input: { clientId: string; entityId: string; date: string; lines: OpeningLineInput[] }): Promise<Result> {
  try {
    const client = await getClientForFirm(input.clientId);
    const m = input.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return { ok: false, error: "Isi tanggal saldo awal." };
    await postOpening(prisma, { clientId: client.id, entityId: input.entityId, date: dateOnly(Number(m[1]), Number(m[2]), Number(m[3])), lines: input.lines });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Demo reset is operator-only tooling; never truncate shared workspace data from a session. */
export async function resetDemoAction(): Promise<Result> {
  await getCurrentFirm();
  return { ok: false, error: "Reset data hanya tersedia melalui alat operator di lingkungan demo." };
}

/** Kurs page: typed-in rates are firm data (source MANUAL) and win over rates taken from files. */
export async function saveRateAction(input: { clientId: string; currency: string; quote: string; date: string; kind: string; rate: string; note?: string }): Promise<Result> {
  try {
    const client = await getClientForFirm(input.clientId);
    const row = validateRateInput(input);
    await upsertRate(prisma, client.firmId, { ...row, source: "MANUAL", note: input.note?.trim().slice(0, 200) || null });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteRateAction(clientId: string, rateId: string): Promise<Result> {
  try {
    const client = await getClientForFirm(clientId);
    const { count } = await prisma.exchangeRate.deleteMany({ where: { id: rateId, firmId: client.firmId } });
    if (!count) return { ok: false, error: "Kurs tidak ditemukan." };
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Month-end FX revaluation — posted only on this explicit click (rule 6b). */
export async function revaluationAction(clientId: string, entityId: string, year: number, month: number): Promise<Result> {
  try {
    const client = await getClientForFirm(clientId);
    if (!client.entities.some((e) => e.id === entityId)) return { ok: false, error: "Entitas tidak ditemukan." };
    await postRevaluation(prisma, client.id, entityId, year, month);
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ─── Ledger / Neraca import (accounting-rules §15a) ───────────────────────────

export async function stageLedgerAction(
  formData: FormData,
): Promise<Result<{ importId?: string; candidates?: { sheet: string; mode: "LEDGER" | "NERACA"; dataRows: number }[] }>> {
  try {
    const client = await getClientForFirm(String(formData.get("clientId")));
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Pilih file buku besar atau neraca (XLSX atau CSV)." };
    if (file.size > MAX_UPLOAD) return { ok: false, error: "File terlalu besar (maks. 5 MB)." };
    const entityId = String(formData.get("entityId") ?? "") || undefined;
    if (entityId && !client.entities.some((e) => e.id === entityId)) return { ok: false, error: "Entitas tidak ditemukan." };
    const date = String(formData.get("date") ?? "");
    const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const res = await stageImport(prisma, {
      firmId: client.firmId,
      clientId: client.id,
      fileName: file.name,
      data: Buffer.from(await file.arrayBuffer()),
      sheet: String(formData.get("sheet") ?? "") || undefined,
      entityId,
      date: m ? dateOnly(Number(m[1]), Number(m[2]), Number(m[3])) : undefined,
      currencyMode: formData.get("currencyMode") === "CONVERT" ? "CONVERT" : "FUNCTIONAL",
    });
    if (res.status === "CHOOSE_SHEET") return { ok: true, candidates: res.candidates.map((c) => ({ sheet: c.sheet, mode: c.mode, dataRows: c.dataRows })) };
    // Rule-based suggestions right away (no AI, no credit); AI only when the accountant asks on the mapping step.
    await suggestMappings(prisma, { firmId: client.firmId, clientId: client.id, provider: null, useAi: false });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true, importId: res.importId };
  } catch (e) {
    return fail(e);
  }
}

export async function acceptCheckAction(clientId: string, checkId: string): Promise<Result> {
  try {
    const client = await getClientForFirm(clientId);
    await acceptCheck(prisma, client.id, checkId);
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Fills suggestions only (rules, then AI when asked). Nothing is mapped until acceptMappingsAction. */
export async function suggestMappingsAction(clientId: string, useAi: boolean): Promise<Result<{ note?: string; aiAnswered: number; calls: number }>> {
  try {
    const client = await getClientForFirm(clientId);
    const r = await suggestMappings(prisma, { firmId: client.firmId, clientId: client.id, provider: useAi ? await resolveProvider(prisma) : null, useAi });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true, note: r.note, aiAnswered: r.aiAnswered, calls: r.calls };
  } catch (e) {
    return fail(e);
  }
}

export async function acceptMappingsAction(
  clientId: string,
  items: { sourceAccountId: string; accountCode?: string; newAccount?: { fsLine: string; name: string }; method: string }[],
): Promise<Result<{ mapped: number }>> {
  try {
    const client = await getClientForFirm(clientId);
    const methods = ["PRIOR", "NAME", "KEYWORD", "AI", "MANUAL", "NEW"];
    if (items.some((i) => !methods.includes(i.method))) return { ok: false, error: "Metode pemetaan tidak dikenal." };
    const r = await acceptMappings(
      prisma,
      client.id,
      items.map((i) => ({ sourceAccountId: i.sourceAccountId, accountCode: i.accountCode, newAccount: i.newAccount ? { fsLine: i.newAccount.fsLine as FsLine, name: i.newAccount.name } : undefined, method: i.method as MapMethod })),
    );
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true, mapped: r.mapped };
  } catch (e) {
    return fail(e);
  }
}

export async function postLedgerImportAction(clientId: string, importId: string): Promise<Result<{ entries: number }>> {
  try {
    const client = await getClientForFirm(clientId);
    const r = await postImport(prisma, client.id, importId);
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true, entries: r.entries };
  } catch (e) {
    return fail(e);
  }
}

export async function discardLedgerDraftAction(clientId: string, importId: string): Promise<Result> {
  try {
    const client = await getClientForFirm(clientId);
    const count = await prisma.$transaction(async (tx) => {
      const { count } = await tx.ledgerImport.deleteMany({ where: { id: importId, clientId: client.id, status: "DRAFT" } });
      // A draft prepared from Dokumen can be prepared again after discarding it.
      if (count) await tx.evidenceSelection.updateMany({ where: { firmId: client.firmId, importId }, data: { importId: null } });
      return count;
    });
    if (!count) return { ok: false, error: "Draf tidak ditemukan atau sudah dicatat." };
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// Public UI action facade; explicit async exports are required by Next.js.
import * as evidenceActions from "./evidence-actions";
import * as googleActions from "./google-actions";
export async function createEvidenceAction(...args: Parameters<typeof evidenceActions.createEvidenceAction>) { return evidenceActions.createEvidenceAction(...args); }
export async function loadEvidenceAction(...args: Parameters<typeof evidenceActions.loadEvidenceAction>) { return evidenceActions.loadEvidenceAction(...args); }
export async function beginEvidenceUploadAction(...args: Parameters<typeof evidenceActions.beginEvidenceUploadAction>) { return evidenceActions.beginEvidenceUploadAction(...args); }
export async function appendEvidenceUploadAction(...args: Parameters<typeof evidenceActions.appendEvidenceUploadAction>) { return evidenceActions.appendEvidenceUploadAction(...args); }
export async function finishEvidenceUploadAction(...args: Parameters<typeof evidenceActions.finishEvidenceUploadAction>) { return evidenceActions.finishEvidenceUploadAction(...args); }
export async function processEvidenceAction(...args: Parameters<typeof evidenceActions.processEvidenceAction>) { return evidenceActions.processEvidenceAction(...args); }
export async function attachDriveAction(...args: Parameters<typeof evidenceActions.attachDriveAction>) { return evidenceActions.attachDriveAction(...args); }
export async function includeEvidenceAction(...args: Parameters<typeof evidenceActions.includeEvidenceAction>) { return evidenceActions.includeEvidenceAction(...args); }
export async function excludeEvidenceAction(...args: Parameters<typeof evidenceActions.excludeEvidenceAction>) { return evidenceActions.excludeEvidenceAction(...args); }
export async function confirmEvidenceAction(...args: Parameters<typeof evidenceActions.confirmEvidenceAction>) { return evidenceActions.confirmEvidenceAction(...args); }
export async function decideEvidenceFactAction(...args: Parameters<typeof evidenceActions.decideEvidenceFactAction>) { return evidenceActions.decideEvidenceFactAction(...args); }
export async function resolveEvidenceConflictAction(...args: Parameters<typeof evidenceActions.resolveEvidenceConflictAction>) { return evidenceActions.resolveEvidenceConflictAction(...args); }
export async function createEvidenceClientAction(...args: Parameters<typeof evidenceActions.createEvidenceClientAction>) { return evidenceActions.createEvidenceClientAction(...args); }
export async function linkEvidenceClientAction(...args: Parameters<typeof evidenceActions.linkEvidenceClientAction>) { return evidenceActions.linkEvidenceClientAction(...args); }
export async function analyzeEvidenceAction(...args: Parameters<typeof evidenceActions.analyzeEvidenceAction>) { return evidenceActions.analyzeEvidenceAction(...args); }
export async function askEvidenceAction(...args: Parameters<typeof evidenceActions.askEvidenceAction>) { return evidenceActions.askEvidenceAction(...args); }
export async function prepareEvidenceImportAction(...args: Parameters<typeof evidenceActions.prepareEvidenceImportAction>) { return evidenceActions.prepareEvidenceImportAction(...args); }
export async function postEvidenceBankAction(...args: Parameters<typeof evidenceActions.postEvidenceBankAction>) { return evidenceActions.postEvidenceBankAction(...args); }
export async function startGoogleAction(...args: Parameters<typeof googleActions.startGoogleAction>) { return googleActions.startGoogleAction(...args); }
export async function disconnectGoogleAction(...args: Parameters<typeof googleActions.disconnectGoogleAction>) { return googleActions.disconnectGoogleAction(...args); }
