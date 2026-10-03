"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getClientForFirm, getCurrentFirm, getCurrentMember } from "@/lib/tenant";
import { importStatement, type ImportSummary } from "@/lib/import/pipeline";
import { resolveProvider } from "@/lib/settings/ai";
import { acceptSimilar, reviewTransaction, splitTransaction, unpairTransfer, type SplitPartInput } from "@/lib/review";
import { CloseError, lockPeriod, runControls, unlockPeriod } from "@/lib/controls";
import { LedgerError } from "@/lib/ledger/post";
import { postAdjustment } from "@/lib/ledger/adjustment";
import { reverseEntry } from "@/lib/ledger/reverse";
import { createSchedule, postAllDue, postInstallment, stopSchedule, type ScheduleInput } from "@/lib/adjust/schedules";
import { createAsset, type AssetInput } from "@/lib/assets/register";
import { disposeAsset, type DisposalInput } from "@/lib/assets/dispose";
import { cancelLease, createLease, postLeaseMonths, type LeaseInput } from "@/lib/leases/register";
import { deleteEmployee, importCensus, saveBenefitSetting, saveEmployee, uploadMortality, type BenefitSettingInput, type EmployeeInput } from "@/lib/benefits/census";
import { postBenefits } from "@/lib/benefits/valuation";
import { createInvoice, type InvoiceInput } from "@/lib/receivables/invoices";
import { settleWithReclass, unsettle } from "@/lib/receivables/settle";
import { candidateViews, type CandidateView } from "@/lib/receivables/view";
import { postCkpn, saveCkpnSetting, type CkpnSettingInput } from "@/lib/receivables/ckpn";
import { taxPack } from "@/lib/tax/pack";
import { postTax } from "@/lib/tax/post";
import { recordInventoryCount } from "@/lib/inventory";
import { acceptSuggestion, addCorrection, addCredit, deleteCorrection, deleteCredit, deleteLoss, dismissSuggestion, setCorrectionPercent, setLoss, setRegime, setTaxMonth, type CorrectionInput, type CreditInput } from "@/lib/tax/records";
import type { TaxPostingKind, TaxRegime } from "@/lib/generated/prisma/enums";
import { AccountMismatchError, ParseError, YearNeededError } from "@/lib/import/types";
import { PdfPasswordError } from "@/lib/import/parsers/pdf";
import { MoneyError, parseMoney } from "@/lib/money";
import { dateOnly } from "@/lib/format";
import { liveUploadFile } from "@/lib/demo/seed";
import { addBankAccount, addClient, addEntity, OnboardingError, type NewClientInput } from "@/lib/onboarding";
import { EntitySettingsError, setFiscalYearEnd, setReportingFramework } from "@/lib/entity-settings";
import { FormatError, resetReportFormat, saveReportFormat } from "@/lib/reports/format-settings";
import { deleteSubledgerImport, importAging, resolveSubledgerFinding, SubledgerError } from "@/lib/reconcile/subledger";
import { OpeningError, postOpening, type OpeningLineInput } from "@/lib/opening";
import { FindingError, resolveOpeningFinding } from "@/lib/findings";
import { removeLedgerImport, removeStatementImport, RemoveImportError } from "@/lib/imports/remove";
import { saveControlNote } from "@/lib/controls/ack";
import type { TaxTag, WithholdingKind } from "@/lib/generated/prisma/enums";
import { RateError, upsertRate, validateRateInput } from "@/lib/fx/rates";
import { MAX_UPLOAD_BYTES } from "@/lib/upload";
import { postRevaluation, RevaluationError } from "@/lib/fx/revalue";
import { reviewClose, type CloseReviewView } from "@/lib/controls/ai-review";
import { explainControl, ExplainError, type ControlExplanation } from "@/lib/controls/explain";
import { dismissProposal, postProposal } from "@/lib/adjust/proposals";
import { postSuspenseCorrection, SUSPENSE_NOT_DISMISSABLE, SUSPENSE_PREFIX } from "@/lib/adjust/suspense";
import { AiBudgetError } from "@/lib/ai/budget";
import { AI_LONG_TIMEOUT_MS, AiAnswerError } from "@/lib/ai/provider";
import { suggestAgainWithAi } from "@/lib/ai/retry";
import { acceptCheck, LedgerImportError, postImport, stageImport } from "@/lib/ledger-import/post";
import { acceptMappings, MappingError, suggestMappings } from "@/lib/ledger-import/mapping";
import { infraErrorMessage } from "@/lib/db-errors";
import { deleteClient, DeleteClientError } from "@/lib/clients/delete";
import { requireMember } from "@/lib/auth/session";
import type { FsLine } from "@/lib/coa/template";
import type { MapMethod } from "@/lib/generated/prisma/enums";

/**
 * Server actions — the only write path from the UI. Each returns {ok, …} or {ok:false, error}
 * with a Bahasa message the UI shows verbatim. Domain errors are expected; others are bugs.
 */
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; needsPassword?: boolean; needsYear?: boolean; yearGuess?: number | null; fields?: Record<string, string>; suggestBankAccountId?: string };

function fail(e: unknown): { ok: false; error: string; needsPassword?: boolean; needsYear?: boolean; yearGuess?: number | null } {
  if (e instanceof PdfPasswordError) return { ok: false, error: e.message, needsPassword: true };
  if (e instanceof YearNeededError) return { ok: false, error: e.message, needsYear: true, yearGuess: e.guess };
  if (e instanceof DeleteClientError) return { ok: false, error: e.message };
  if (e instanceof ParseError || e instanceof LedgerError || e instanceof CloseError || e instanceof OpeningError || e instanceof FindingError || e instanceof RemoveImportError || e instanceof MoneyError || e instanceof RateError || e instanceof RevaluationError || e instanceof LedgerImportError || e instanceof MappingError || e instanceof EntitySettingsError || e instanceof FormatError || e instanceof SubledgerError) return { ok: false, error: e.message };
  const infra = infraErrorMessage(e);
  console.error(e);
  return { ok: false, error: infra ?? "Terjadi kesalahan tak terduga. Coba lagi." };
}

const MAX_UPLOAD = MAX_UPLOAD_BYTES;

export async function importAction(formData: FormData): Promise<Result<{ summary: ImportSummary }>> {
  let banks: { id: string; number: string }[] = [];
  let selected = "";
  try {
    const clientId = String(formData.get("clientId"));
    const bankAccountId = String(formData.get("bankAccountId"));
    const file = formData.get("file");
    const password = String(formData.get("password") ?? "") || undefined; // used once to open the PDF, never stored
    const yearText = String(formData.get("year") ?? "").trim();
    const year = yearText ? Number(yearText) : undefined;
    if (year !== undefined && !(Number.isInteger(year) && year >= 2000 && year <= 2100)) return { ok: false, error: "Tahun harus 4 angka, misalnya 2026.", needsYear: true };
    const client = await getClientForFirm(clientId);
    banks = client.entities.flatMap((e) => e.bankAccounts);
    selected = bankAccountId;
    if (!client.entities.some((e) => e.bankAccounts.some((b) => b.id === bankAccountId))) return { ok: false, error: "Pilih rekening bank dulu." };
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Pilih file rekening koran (PDF, CSV, XLS, atau XLSX)." };
    if (file.size > MAX_UPLOAD) return { ok: false, error: "File terlalu besar (maks. 5 MB)." };
    const summary = await importStatement(prisma, { bankAccountId, fileName: file.name, data: Buffer.from(await file.arrayBuffer()), provider: await resolveProvider(prisma), password, year, actorId: (await getCurrentMember()).id });
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, summary };
  } catch (e) {
    // The file belongs to another account of this client: say which, so the form can switch to it in one click.
    if (e instanceof AccountMismatchError) {
      const digits = (s: string) => s.replace(/\D/g, "");
      const match = banks.find((b) => b.id !== selected && e.fileNumbers.some((n) => digits(n) === digits(b.number)));
      return { ...fail(e), suggestBankAccountId: match?.id };
    }
    return fail(e);
  }
}

/** Demo shortcut: import the held-back statement without hunting for the file. */
export async function importSampleAction(clientId: string, bankAccountId: string): Promise<Result<{ summary: ImportSummary }>> {
  try {
    const client = await getClientForFirm(clientId);
    if (!client.entities.some((e) => e.bankAccounts.some((b) => b.id === bankAccountId))) return { ok: false, error: "Rekening tidak ditemukan." };
    const f = await liveUploadFile();
    const summary = await importStatement(prisma, { bankAccountId, fileName: f.fileName, data: f.data, provider: await resolveProvider(prisma), actorId: (await getCurrentMember()).id });
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

/** *Lepas pasangan*: two lines are not one transfer; both go back to Review and are never paired again (UC-B2). */
export async function unpairTransferAction(input: { bankTxId: string }): Promise<Result> {
  try {
    const clientId = await assertTxInFirm(input.bankTxId);
    await unpairTransfer(prisma, { clientId, bankTxId: input.bankTxId, actorId: (await getCurrentMember()).id });
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function reviewAction(input: { bankTxId: string; accountCode: string; taxTag: TaxTag | null; createRule?: boolean; /** Tax withheld (major units); undefined keeps the line's, null removes it. */ withholding?: { kind: WithholdingKind; amount: string } | null; /** Merge a split line back onto this one account (Buku Besar). */ replaceSplit?: boolean }): Promise<Result<{ learned: boolean }>> {
  try {
    const clientId = await assertTxInFirm(input.bankTxId);
    const { withholding, ...rest } = input;
    let parsed: { kind: WithholdingKind; amount: bigint } | null | undefined;
    if (withholding) {
      const t = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: input.bankTxId }, select: { bankAccount: { select: { entity: { select: { functionalCurrency: true } } } } } });
      parsed = { kind: withholding.kind, amount: parseMoney(withholding.amount, t.bankAccount.entity.functionalCurrency) };
    } else parsed = withholding;
    // Memory learns only keys that name a counterparty, and never an unchanged simple guess (lib/review.ts): the toast must not promise more.
    const { learned } = await reviewTransaction(prisma, { ...rest, withholding: parsed, actorId: (await getCurrentMember()).id });
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, learned };
  } catch (e) {
    return fail(e);
  }
}

/** *Minta saran AI* on Review for lines that only have the simple guess (lib/ai/retry.ts). Suggestions only; nothing posts. */
/** Pecah transaksi: a combined bank line across accounts; the parts must add up to the line (lib/review.ts). */
export async function splitTransactionAction(input: { bankTxId: string; parts: SplitPartInput[] }): Promise<Result> {
  try {
    const clientId = await assertTxInFirm(input.bankTxId);
    await splitTransaction(prisma, { bankTxId: input.bankTxId, parts: input.parts, actorId: (await getCurrentMember()).id });
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function suggestAgainAction(clientId: string, scope: { entityIds: string[]; period: string }): Promise<Result<{ rows: number; updated: number; note?: string }>> {
  try {
    const client = await getClientForFirm(clientId);
    if (!scope || !/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(scope.period) || !scope.entityIds.length || scope.entityIds.some((id) => !client.entities.some((e) => e.id === id))) return { ok: false, error: "Cakupan review tidak valid. Muat ulang halaman." };
    const provider = await resolveProvider(prisma);
    if (!provider) return { ok: false, error: "AI belum diatur di Pengaturan, jadi belum ada saran AI. Pilih akunnya langsung." };
    const through = new Date(Date.UTC(Number(scope.period.slice(0, 4)), Number(scope.period.slice(5)), 0));
    const r = await suggestAgainWithAi(prisma, { clientId: client.id, entityIds: scope.entityIds, through, provider });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true, rows: r.rows, updated: r.updated, note: r.note };
  } catch (e) {
    return fail(e);
  }
}

export async function acceptSimilarAction(
  bankTxId: string,
  scope: { entityIds: string[]; period: string },
  choice?: { accountCode: string; taxTag: TaxTag | null },
): Promise<Result<{ ids: string[] }>> {
  try {
    const clientId = await assertTxInFirm(bankTxId);
    const client = await getClientForFirm(clientId);
    const source = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: bankTxId } });
    if (!scope || !/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(scope.period) || !scope.entityIds.length || scope.entityIds.some(id => !client.entities.some(e => e.id === id)) || !scope.entityIds.includes(source.entityId)) return { ok: false, error: "Cakupan review tidak valid. Muat ulang halaman." };
    const through = new Date(Date.UTC(Number(scope.period.slice(0, 4)), Number(scope.period.slice(5)), 0));
    if (source.date > through) return { ok: false, error: "Transaksi berada di luar periode review." };
    if (choice && !(await prisma.account.findFirst({ where: { clientId, code: choice.accountCode, isBank: false, isSuspense: false } }))) return { ok: false, error: `Akun ${choice.accountCode} tidak ada di bagan akun klien ini.` };
    const ids = await acceptSimilar(prisma, bankTxId, { entityIds: scope.entityIds, through }, (await getCurrentMember()).id, choice);
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, ids };
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
    const ackedById = (await getCurrentMember()).id;
    // The note answers the control as it reads now; when its detail changes the note stops clearing it (lib/controls runControls).
    const control = (await runControls(prisma, clientId, year, month)).find((c) => c.key === controlKey);
    await saveControlNote(prisma, { clientId, periodId: period.id, year, month, controlKey, title: control ? `${control.title} · ${control.scope}` : undefined, note, detail: control?.detail ?? null, actorId: ackedById });
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function signoffAction(clientId: string, year: number, month: number, key: string, done: boolean): Promise<Result> {
  try {
    const period = await periodFor(clientId, year, month, { mustBeOpen: true });
    const doneById = (await getCurrentMember()).id;
    if (done) await prisma.closeSignoff.upsert({ where: { periodId_key: { periodId: period.id, key } }, create: { periodId: period.id, key, doneById }, update: { doneById, doneAt: new Date() } });
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
    await lockPeriod(prisma, clientId, year, month, "Ditutup dari halaman Tutup Buku", (await getCurrentMember()).id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Admin only, in reverse order of closing, with a reason that is kept in the unlock log (lib/controls unlockPeriod). */
export async function unlockAction(clientId: string, year: number, month: number, reason: string): Promise<Result> {
  try {
    await getClientForFirm(clientId);
    await unlockPeriod(prisma, clientId, year, month, await getCurrentMember(), reason);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** *Balik jurnal* on a manual adjustment (lib/ledger/reverse.ts): tenant checked through the entry's client. */
export async function reverseEntryAction(input: { entryId: string; date: string }): Promise<Result> {
  try {
    const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: input.entryId }, select: { entity: { select: { clientId: true } } } });
    const client = await getClientForFirm(entry.entity.clientId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, error: "Pilih tanggal jurnal pembalik." };
    await reverseEntry(prisma, { clientId: client.id, entryId: input.entryId, date: new Date(`${input.date}T00:00:00Z`), actorId: (await getCurrentMember()).id });
    revalidatePath(`/clients/${client.id}`, "layout");
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
    const entry = await postAdjustment(prisma, { clientId: client.id, entityId: input.entityId, date: new Date(`${input.date}T00:00:00Z`), memo: input.memo, lines: input.lines, actorId: (await getCurrentMember()).id });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true, entryId: entry.id };
  } catch (e) {
    return fail(e);
  }
}

/** Adjustment schedules (accounting-rules 5a): create, post an installment or every due one, stop. */
export async function createScheduleAction(input: Omit<ScheduleInput, "actorId">): Promise<Result<{ scheduleId: string }>> {
  try {
    const client = await getClientForFirm(input.clientId);
    const s = await createSchedule(prisma, { ...input, clientId: client.id, actorId: (await getCurrentMember()).id });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true, scheduleId: s.id };
  } catch (e) {
    return fail(e);
  }
}

/** Register a fixed asset (and its depreciation schedule, in the same transaction). Nothing posts. */
export async function createAssetAction(input: Omit<AssetInput, "actorId">): Promise<Result<{ assetId: string }>> {
  try {
    const client = await getClientForFirm(input.clientId);
    const a = await createAsset(prisma, { ...input, clientId: client.id, actorId: (await getCurrentMember()).id });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true, assetId: a.id };
  } catch (e) {
    return fail(e);
  }
}

/** Lease register (rule 5f): registration posts the commencement entry; monthly journals and cancellation by click. */
export async function createLeaseAction(input: Omit<LeaseInput, "actorId">) {
  return taxWrite(input.clientId, (clientId, actorId) => createLease(prisma, { ...input, clientId, actorId }));
}
export async function postLeaseMonthsAction(input: { clientId: string; entityId: string; year: number; month: number }) {
  return taxWrite(input.clientId, (clientId, actorId) => postLeaseMonths(prisma, { ...input, clientId, actorId }));
}
export async function cancelLeaseAction(clientId: string, leaseId: string) {
  return taxWrite(clientId, (id, actorId) => cancelLease(prisma, { clientId: id, leaseId, actorId }));
}

/** Employee benefits (rule 5g): census, the firm's mortality table, assumptions, and the valuation journal by click. */
async function uploaded(formData: FormData, what: string) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new LedgerError(`Pilih file ${what} (XLSX, XLS, atau CSV).`);
  if (file.size > MAX_UPLOAD) throw new LedgerError("File terlalu besar (maks. 5 MB).");
  return { fileName: file.name, data: Buffer.from(await file.arrayBuffer()) };
}
export async function importCensusAction(formData: FormData): Promise<Result<{ added: number; updated: number }>> {
  try {
    const client = await getClientForFirm(String(formData.get("clientId")));
    const r = await importCensus(prisma, { clientId: client.id, entityId: String(formData.get("entityId")), ...(await uploaded(formData, "sensus karyawan")) });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true, ...r };
  } catch (e) {
    return fail(e);
  }
}
export async function uploadMortalityAction(formData: FormData): Promise<Result<{ tableId: string }>> {
  try {
    const client = await getClientForFirm(String(formData.get("clientId")));
    const t = await uploadMortality(prisma, { firmId: client.firmId, name: String(formData.get("name") ?? ""), ...(await uploaded(formData, "tabel mortalita")) });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true, tableId: t.id };
  } catch (e) {
    return fail(e);
  }
}
export async function saveEmployeeAction(input: EmployeeInput) {
  return taxWrite(input.clientId, (clientId) => saveEmployee(prisma, { ...input, clientId }));
}
export async function deleteEmployeeAction(clientId: string, employeeId: string) {
  return taxWrite(clientId, (id) => deleteEmployee(prisma, { clientId: id, employeeId }));
}
export async function saveBenefitSettingAction(input: BenefitSettingInput) {
  return taxWrite(input.clientId, (clientId) => saveBenefitSetting(prisma, { ...input, clientId }));
}
export async function postBenefitsAction(input: { clientId: string; entityId: string; year: number; month: number }) {
  return taxWrite(input.clientId, (clientId, actorId) => postBenefits(prisma, { ...input, clientId, actorId }));
}

/** The accountant's click: one disposal entry (rule 5b). */
export async function disposeAssetAction(input: Omit<DisposalInput, "actorId">): Promise<Result<{ entryId: string }>> {
  try {
    const client = await getClientForFirm(input.clientId);
    const r = await disposeAsset(prisma, { ...input, clientId: client.id, actorId: (await getCurrentMember()).id });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true, entryId: r.entryId };
  } catch (e) {
    return fail(e);
  }
}

/** Record a sales invoice or purchase bill (posts its journal unless it is a Saldo Awal item). */
export async function createInvoiceAction(input: Omit<InvoiceInput, "actorId">): Promise<Result<{ invoiceId: string }>> {
  try {
    const client = await getClientForFirm(input.clientId);
    const inv = await createInvoice(prisma, { ...input, clientId: client.id, actorId: (await getCurrentMember()).id });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true, invoiceId: inv.id };
  } catch (e) {
    return fail(e);
  }
}

/** Bank lines that could settle an invoice (read-only). */
export async function settleCandidatesAction(clientId: string, invoiceId: string): Promise<Result<{ candidates: CandidateView[] }>> {
  try {
    const client = await getClientForFirm(clientId);
    return { ok: true, candidates: await candidateViews(prisma, client.id, invoiceId) };
  } catch (e) {
    return fail(e);
  }
}

/** Settle an invoice with a bank line; a line not on the invoice's account is classified to it first (reviewer's writer). */
export async function settleAction(input: { clientId: string; invoiceId: string; bankTransactionId: string; amount?: string | null; withheld?: string | null; whtKind?: WithholdingKind | null }): Promise<Result> {
  try {
    const client = await getClientForFirm(input.clientId);
    await settleWithReclass(prisma, { ...input, clientId: client.id, actorId: (await getCurrentMember()).id });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function unsettleAction(clientId: string, settlementId: string): Promise<Result> {
  try {
    const client = await getClientForFirm(clientId);
    await unsettle(prisma, { clientId: client.id, settlementId });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Tax pack (accounting-rules 5d): every write is tenant-checked and returns the verbatim Bahasa error. */
async function taxWrite(clientId: string, write: (clientId: string, actorId: string) => Promise<unknown>): Promise<Result> {
  try {
    const client = await getClientForFirm(clientId);
    await write(client.id, (await getCurrentMember()).id);
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setRegimeAction(input: { clientId: string; entityId: string; year: number; regime: TaxRegime }) {
  return taxWrite(input.clientId, (clientId) => setRegime(prisma, { ...input, clientId }));
}
export async function addCorrectionAction(input: Omit<CorrectionInput, "actorId">) {
  return taxWrite(input.clientId, (clientId, actorId) => addCorrection(prisma, { ...input, clientId, actorId }));
}
export async function deleteCorrectionAction(clientId: string, correctionId: string) {
  return taxWrite(clientId, (id) => deleteCorrection(prisma, { clientId: id, correctionId }));
}
/** The amount is read again from the ledger here, never taken from the page. */
export async function acceptSuggestionAction(input: { clientId: string; entityId: string; year: number; month: number; accountCode: string; percent?: number }) {
  return taxWrite(input.clientId, async (clientId, actorId) => {
    const pack = await taxPack(prisma, clientId, input.entityId, input.year, input.month);
    const s = pack?.suggestions.find((x) => x.code === input.accountCode);
    if (!s) throw new LedgerError("Usulan ini sudah tidak berlaku. Muat ulang halaman.");
    await acceptSuggestion(prisma, { clientId, entityId: input.entityId, year: input.year, accountCode: s.code, amount: s.amount, percent: input.percent, actorId });
  });
}
export async function setCorrectionPercentAction(clientId: string, correctionId: string, percent: number) {
  return taxWrite(clientId, (id) => setCorrectionPercent(prisma, { clientId: id, correctionId, percent }));
}
export async function setLossAction(input: { clientId: string; entityId: string; year: number; originYear: number; amount: string }) {
  return taxWrite(input.clientId, (clientId, actorId) => setLoss(prisma, { ...input, clientId, actorId }));
}
export async function deleteLossAction(clientId: string, lossId: string) {
  return taxWrite(clientId, (id) => deleteLoss(prisma, { clientId: id, lossId }));
}
export async function dismissSuggestionAction(input: { clientId: string; entityId: string; year: number; key: string }) {
  return taxWrite(input.clientId, (clientId) => dismissSuggestion(prisma, { ...input, clientId }));
}
export async function addCreditAction(input: Omit<CreditInput, "actorId">) {
  return taxWrite(input.clientId, (clientId, actorId) => addCredit(prisma, { ...input, clientId, actorId }));
}
export async function deleteCreditAction(clientId: string, creditId: string) {
  return taxWrite(clientId, (id) => deleteCredit(prisma, { clientId: id, creditId }));
}
/** The masa pajak of a PPh 25 instalment: which year's credit it is (lib/tax/records.ts). */
export async function setTaxMonthAction(clientId: string, bankTransactionId: string, month: string) {
  return taxWrite(clientId, (id) => setTaxMonth(prisma, { clientId: id, bankTransactionId, month }));
}
/** The accountant's click: the tax journal of a kind, as the difference from what is already booked. */
export async function saveCkpnSettingAction(input: CkpnSettingInput) {
  return taxWrite(input.clientId, (clientId) => saveCkpnSetting(prisma, { ...input, clientId }));
}
export async function postCkpnAction(input: { clientId: string; entityId: string; year: number; month: number }) {
  return taxWrite(input.clientId, (clientId, actorId) => postCkpn(prisma, { ...input, clientId, actorId }));
}

/** Month-end stock count (rule 5i): the typed value is read in the entity's currency; the journal is the difference from the books. */
export async function recordInventoryCountAction(input: { clientId: string; entityId: string; year: number; month: number; amount: string; note?: string }) {
  return taxWrite(input.clientId, async (clientId, actorId) => {
    const entity = await prisma.entity.findFirst({ where: { id: input.entityId, clientId } });
    if (!entity) throw new LedgerError("Pilih entitas.");
    if (!input.amount.trim()) throw new LedgerError("Isi nilai persediaan hasil stock opname (0 bila habis).");
    const amount = parseMoney(input.amount, entity.functionalCurrency);
    return recordInventoryCount(prisma, { clientId, entityId: entity.id, year: input.year, month: input.month, amount, note: input.note, actorId });
  });
}

export async function postTaxAction(input: { clientId: string; entityId: string; year: number; month: number; kind: TaxPostingKind }) {
  return taxWrite(input.clientId, (clientId, actorId) => postTax(prisma, { ...input, clientId, actorId }));
}

export async function postInstallmentAction(clientId: string, scheduleId: string, k: number): Promise<Result> {
  try {
    const client = await getClientForFirm(clientId);
    await postInstallment(prisma, { clientId: client.id, scheduleId, k, actorId: (await getCurrentMember()).id });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function postAllDueAction(clientId: string, year: number, month: number): Promise<Result<{ posted: number }>> {
  try {
    const client = await getClientForFirm(clientId);
    const posted = await postAllDue(prisma, { clientId: client.id, year, month, actorId: (await getCurrentMember()).id });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true, posted };
  } catch (e) {
    return fail(e);
  }
}

export async function stopScheduleAction(clientId: string, scheduleId: string): Promise<Result> {
  try {
    const client = await getClientForFirm(clientId);
    await stopSchedule(prisma, { clientId: client.id, scheduleId });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true };
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

type NewEntityInput = NewClientInput["entities"][number];

/** "Tambah rekening" on an entity of an existing client. `fields` keys ("bank.number") say what to fix. */
export async function addBankAccountAction(clientId: string, entityId: string, input: NewEntityInput["banks"][number]): Promise<Result<{ bankAccountId: string }>> {
  try {
    const client = await getClientForFirm(clientId);
    const bank = await addBankAccount(prisma, client.firmId, client.id, entityId, input);
    revalidatePath("/", "layout");
    return { ok: true, bankAccountId: bank.id };
  } catch (e) {
    if (e instanceof OnboardingError) return { ok: false, error: e.message, fields: e.fields };
    return fail(e);
  }
}

/** "Tambah perusahaan atau pemilik" on an existing client. */
export async function addEntityAction(clientId: string, input: NewEntityInput): Promise<Result<{ entityId: string }>> {
  try {
    const client = await getClientForFirm(clientId);
    const entity = await addEntity(prisma, client.firmId, client.id, input);
    revalidatePath("/", "layout");
    return { ok: true, entityId: entity.id };
  } catch (e) {
    if (e instanceof OnboardingError) return { ok: false, error: e.message, fields: e.fields };
    return fail(e);
  }
}

/** Which standard an entity's CALK and statements name (wording only, lib/reports/framework.ts). */
export async function saveReportingFrameworkAction(clientId: string, entityId: string, framework: string): Promise<Result> {
  try {
    const client = await getClientForFirm(clientId);
    await setReportingFramework(prisma, { clientId: client.id, entityId, framework });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** The client's financial-year end (tahun buku): which year its reports count from. Refused once a month is closed. */
export async function saveFiscalYearEndAction(clientId: string, endMonth: number): Promise<Result> {
  try {
    const client = await getClientForFirm(clientId);
    const member = await getCurrentMember();
    await setFiscalYearEnd(prisma, { clientId: client.id, endMonth, actorId: member.id });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Rekonsiliasi subledger (UC-A1): a client's aging file at a date, compared with the ledger. */
export async function importAgingAction(formData: FormData): Promise<Result<{ status: string; difference: string; notes: string[]; rows: number }>> {
  try {
    const client = await getClientForFirm(String(formData.get("clientId")));
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Pilih file aging (XLSX, XLS atau CSV)." };
    if (file.size > MAX_UPLOAD) return { ok: false, error: "File terlalu besar (maks. 5 MB)." };
    const kind = String(formData.get("kind"));
    const r = await importAging(prisma, {
      clientId: client.id,
      entityId: String(formData.get("entityId")),
      kind: kind as "RECEIVABLE" | "PAYABLE",
      asOf: String(formData.get("asOf") ?? ""),
      fileName: file.name,
      data: Buffer.from(await file.arrayBuffer()),
      accountCodes: formData.getAll("accounts").map(String).filter(Boolean),
      threshold: String(formData.get("threshold") ?? ""),
      actorId: (await getCurrentMember()).id,
    });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true, status: r.status, difference: r.difference.toString(), notes: r.notes, rows: r.rows };
  } catch (e) {
    return fail(e);
  }
}

export async function resolveSubledgerFindingAction(input: { clientId: string; findingId: string; explanation: string }): Promise<Result> {
  try {
    const client = await getClientForFirm(input.clientId);
    await resolveSubledgerFinding(prisma, { clientId: client.id, findingId: input.findingId, explanation: input.explanation, actorId: (await getCurrentMember()).id });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteSubledgerImportAction(clientId: string, importId: string): Promise<Result> {
  try {
    const client = await getClientForFirm(clientId);
    await deleteSubledgerImport(prisma, { clientId: client.id, importId, actorId: (await getCurrentMember()).id });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** A client's report format (UC-K3): labels, order, headings and totals of its Laba Rugi and Neraca. Presentation only; refusals name the line. */
export async function saveReportFormatAction(clientId: string, format: unknown): Promise<Result> {
  try {
    const client = await getClientForFirm(clientId);
    const member = await getCurrentMember();
    await saveReportFormat(prisma, { clientId: client.id, actorId: member.id, format });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function resetReportFormatAction(clientId: string): Promise<Result> {
  try {
    const client = await getClientForFirm(clientId);
    const member = await getCurrentMember();
    await resetReportFormat(prisma, { clientId: client.id, actorId: member.id });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function openingAction(input: { clientId: string; entityId: string; date: string; lines: OpeningLineInput[] }): Promise<Result<{ finding: string | null }>> {
  try {
    const client = await getClientForFirm(input.clientId);
    const m = input.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return { ok: false, error: "Isi tanggal saldo awal." };
    const { finding } = await postOpening(prisma, { clientId: client.id, entityId: input.entityId, date: dateOnly(Number(m[1]), Number(m[2]), Number(m[3])), lines: input.lines, actorId: (await getCurrentMember()).id });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true, finding: finding?.label ?? null };
  } catch (e) {
    return fail(e);
  }
}

/** Resolves a Temuan with the accountant's written decision (ADR 0012). */
export async function resolveFindingAction(input: { clientId: string; findingId: string; accountCode: string; decision: string }): Promise<Result> {
  try {
    const client = await getClientForFirm(input.clientId);
    await resolveOpeningFinding(prisma, { clientId: client.id, findingId: input.findingId, accountCode: input.accountCode, decision: input.decision, actorId: (await getCurrentMember()).id });
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
    await postRevaluation(prisma, client.id, entityId, year, month, (await getCurrentMember()).id);
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** AI close review (ADR 0009): explains flagged controls and proposes actions. Never posts, acks or locks. */
export async function closeReviewAction(clientId: string, year: number, month: number): Promise<Result<{ review: CloseReviewView }>> {
  try {
    const client = await getClientForFirm(clientId);
    const provider = await resolveProvider(prisma);
    if (!provider) return { ok: false, error: "AI belum diatur di Pengaturan. Kontrol tetap berjalan tanpa AI." };
    return { ok: true, review: await reviewClose(prisma, client.firmId, client.id, year, month, provider) };
  } catch (e) {
    if (e instanceof AiBudgetError || e instanceof AiAnswerError) return { ok: false, error: e.message };
    if (e instanceof Error && e.name === "TimeoutError") {
      console.error(e);
      return { ok: false, error: `AI tidak menjawab dalam ${Math.round(AI_LONG_TIMEOUT_MS / 60_000)} menit. Kontrol tetap berjalan; coba lagi nanti.` };
    }
    if (e instanceof Error && /^(AI \d|Model )/.test(e.message)) {
      console.error(e);
      return { ok: false, error: "AI tidak tersedia saat ini. Kontrol tetap berjalan; coba lagi nanti." };
    }
    return fail(e);
  }
}

/** Close copilot (accounting-rules 20b): one flagged control explained; a draft journal is stored, never posted here. */
export async function explainControlAction(clientId: string, year: number, month: number, controlKey: string): Promise<Result<{ explanation: ControlExplanation }>> {
  try {
    const client = await getClientForFirm(clientId);
    await periodFor(client.id, year, month, { mustBeOpen: true });
    const provider = await resolveProvider(prisma);
    if (!provider) return { ok: false, error: "AI belum diatur di Pengaturan. Kontrol tetap berjalan tanpa AI." };
    const explanation = await explainControl(prisma, client.firmId, client.id, year, month, controlKey, provider);
    if (explanation.proposal) revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true, explanation };
  } catch (e) {
    if (e instanceof AiBudgetError || e instanceof AiAnswerError || e instanceof ExplainError) return { ok: false, error: e.message };
    if (e instanceof Error && e.name === "TimeoutError") {
      console.error(e);
      return { ok: false, error: `AI tidak menjawab dalam ${Math.round(AI_LONG_TIMEOUT_MS / 60_000)} menit. Kontrol tetap berjalan; coba lagi nanti.` };
    }
    if (e instanceof Error && /^(AI \d|Model )/.test(e.message)) {
      console.error(e);
      return { ok: false, error: "AI tidak tersedia saat ini. Kontrol tetap berjalan; coba lagi nanti." };
    }
    return fail(e);
  }
}

export async function postProposalAction(clientId: string, proposalId: string, accounts: string[]): Promise<Result> {
  try {
    const client = await getClientForFirm(clientId);
    const actorId = (await getCurrentMember()).id;
    if (proposalId.startsWith(SUSPENSE_PREFIX)) await postSuspenseCorrection(prisma, { firmId: client.firmId, clientId: client.id, lineId: proposalId.slice(SUSPENSE_PREFIX.length), accounts, actorId });
    else await postProposal(prisma, { clientId: client.id, proposalId, accounts, actorId });
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function dismissProposalAction(clientId: string, proposalId: string): Promise<Result> {
  try {
    const client = await getClientForFirm(clientId);
    const actorId = (await getCurrentMember()).id;
    if (proposalId.startsWith(SUSPENSE_PREFIX)) return { ok: false, error: SUSPENSE_NOT_DISMISSABLE };
    await dismissProposal(prisma, { clientId: client.id, proposalId, actorId });
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
      actorId: (await getCurrentMember()).id,
    });
    if (res.status === "CHOOSE_SHEET") return { ok: true, candidates: res.candidates.map((c) => ({ sheet: c.sheet, mode: c.mode, dataRows: c.dataRows })) };
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
      (await getCurrentMember()).id,
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
    const r = await postImport(prisma, client.id, importId, (await getCurrentMember()).id);
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

/** Admin only: removes a client and all its books after the typed-name confirmation (lib/clients/delete.ts). */
/** Hapus impor (ADR 0013): admin only; the lib refuses closed months and imports something else rests on. */
export async function removeImportAction(input: { clientId: string; importId: string; kind: "statement" | "ledger"; reason: string }): Promise<Result> {
  try {
    const client = await getClientForFirm(input.clientId);
    const member = await getCurrentMember();
    const args = { clientId: client.id, importId: input.importId, reason: input.reason, actor: { id: member.id, role: member.role } };
    if (input.kind === "statement") await removeStatementImport(prisma, args);
    else await removeLedgerImport(prisma, args);
    revalidatePath(`/clients/${client.id}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteClientAction(clientId: string, confirmName: string): Promise<Result> {
  let member;
  try {
    member = await requireMember("ADMIN");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Hanya admin kantor yang dapat menghapus klien." };
  }
  try {
    const client = await getClientForFirm(clientId);
    const r = await deleteClient(prisma, { firmId: client.firmId, clientId: client.id, confirmName });
    console.info(`client deleted: firm=${client.firmId} client=${client.id} name="${r.name}" by member=${member.id} at ${new Date().toISOString()}`);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
