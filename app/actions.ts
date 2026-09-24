"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getClientForFirm, getCurrentFirm } from "@/lib/tenant";
import { importStatement, type ImportSummary } from "@/lib/import/pipeline";
import { resolveProvider } from "@/lib/settings/ai";
import { acceptSimilar, reviewTransaction } from "@/lib/review";
import { CloseError, lockPeriod } from "@/lib/controls";
import { LedgerError, postJournal } from "@/lib/ledger/post";
import { ParseError } from "@/lib/import/types";
import { PdfPasswordError } from "@/lib/import/parsers/pdf";
import { parseRupiah } from "@/lib/money";
import { liveUploadFile, seedDemo } from "@/lib/demo/seed";
import { addClient, OnboardingError, type NewClientInput } from "@/lib/onboarding";
import type { TaxTag } from "@/lib/generated/prisma/enums";

/**
 * Server actions — the only write path from the UI. Each returns {ok, …} or {ok:false, error}
 * with a Bahasa message the UI shows verbatim. Domain errors are expected; others are bugs.
 */
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; needsPassword?: boolean };

function fail(e: unknown): { ok: false; error: string; needsPassword?: boolean } {
  if (e instanceof PdfPasswordError) return { ok: false, error: e.message, needsPassword: true };
  if (e instanceof ParseError || e instanceof LedgerError || e instanceof CloseError || e instanceof OnboardingError) return { ok: false, error: e.message };
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

export async function acceptSimilarAction(bankTxId: string): Promise<Result<{ count: number }>> {
  try {
    const clientId = await assertTxInFirm(bankTxId);
    const count = await acceptSimilar(prisma, bankTxId);
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
    if (!client.entities.some((e) => e.id === input.entityId)) return { ok: false, error: "Pilih entitas." };
    if (!input.memo.trim()) return { ok: false, error: "Isi keterangan jurnal." };
    const accounts = await prisma.account.findMany({ where: { clientId: client.id } });
    const lines = input.lines
      .filter((l) => l.accountCode)
      .map((l) => {
        const a = accounts.find((x) => x.code === l.accountCode);
        if (!a) throw new LedgerError(`Akun ${l.accountCode} tidak ditemukan`);
        return { accountId: a.id, debit: parseRupiah(l.debit), credit: parseRupiah(l.credit) };
      });
    const entry = await prisma.$transaction((tx) =>
      postJournal(tx, { entityId: input.entityId, date: new Date(`${input.date}T00:00:00Z`), kind: "ADJUSTMENT", memo: input.memo.trim(), lines }),
    );
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
    return fail(e);
  }
}

export async function resetDemoAction(): Promise<Result> {
  if (process.env.DEMO_MODE !== "true") return { ok: false, error: "Reset hanya tersedia di mode demo." };
  try {
    await seedDemo(prisma);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
