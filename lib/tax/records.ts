import type { Db, Tx } from "@/lib/db";
import type { CorrectionDirection, CorrectionKind, TaxCreditType, TaxRegime } from "@/lib/generated/prisma/enums";
import { LedgerError } from "@/lib/ledger/post";
import { dateOnly } from "@/lib/format";
import { parseMoney } from "@/lib/money";
import { packApplies } from "@/lib/tax/pack";
import { categoryOf } from "@/lib/tax/categories";

/**
 * What the accountant records for an entity's fiscal year (accounting-rules 5d): the regime, manual koreksi fiskal, accepted or
 * dismissed suggestions, and tax credits withheld by others. Read-only once the year's December is locked.
 */

async function yearFor(db: Db | Tx, clientId: string, entityId: string, year: number) {
  const entity = await db.entity.findFirst({ where: { id: entityId, clientId } });
  if (!entity) throw new LedgerError("Pilih entitas.");
  if (!packApplies(entity)) throw new LedgerError("Paket PPh badan hanya untuk badan usaha dengan pembukuan Rupiah.");
  if (!(Number.isInteger(year) && year >= 2000 && year <= 2100)) throw new LedgerError("Tahun pajak tidak valid.");
  const december = await db.period.findUnique({ where: { clientId_year_month: { clientId, year, month: 12 } } });
  if (december?.status === "LOCKED") throw new LedgerError(`Desember ${year} sudah dikunci; data pajak ${year} tidak bisa diubah. Buka kunci Desember dulu.`);
  const taxYear = await db.taxYear.upsert({ where: { entityId_year: { entityId, year } }, update: {}, create: { firmId: entity.firmId, clientId, entityId, year } });
  return { entity, taxYear };
}

async function yearOf(db: Db, clientId: string, taxYearId: string) {
  const ty = await db.taxYear.findFirst({ where: { id: taxYearId, clientId } });
  if (!ty) throw new LedgerError("Data pajak tidak ditemukan.");
  return yearFor(db, clientId, ty.entityId, ty.year);
}

export async function setRegime(db: Db, input: { clientId: string; entityId: string; year: number; regime: TaxRegime }) {
  if (input.regime !== "NORMAL" && input.regime !== "FINAL_UMKM") throw new LedgerError("Pilih skema pajak.");
  const { taxYear } = await yearFor(db, input.clientId, input.entityId, input.year);
  return db.taxYear.update({ where: { id: taxYear.id }, data: { regime: input.regime } });
}

export type CorrectionInput = { clientId: string; entityId: string; year: number; description: string; direction: CorrectionDirection; kind: CorrectionKind; amount: string; accountCode?: string | null; actorId?: string | null };

export async function addCorrection(db: Db, input: CorrectionInput) {
  const { entity, taxYear } = await yearFor(db, input.clientId, input.entityId, input.year);
  const description = input.description.trim();
  if (!description) throw new LedgerError("Isi keterangan koreksi.");
  if (!["POSITIVE", "NEGATIVE"].includes(input.direction) || !["PERMANENT", "TEMPORARY"].includes(input.kind)) throw new LedgerError("Pilih jenis koreksi.");
  const amount = parseMoney(input.amount, entity.functionalCurrency);
  if (amount <= 0n) throw new LedgerError("Nominal koreksi harus lebih dari nol.");
  const account = input.accountCode ? await db.account.findFirst({ where: { clientId: input.clientId, code: input.accountCode } }) : null;
  if (input.accountCode && !account) throw new LedgerError(`Akun ${input.accountCode} tidak ada di bagan akun klien.`);
  return db.fiscalCorrection.create({ data: { firmId: entity.firmId, taxYearId: taxYear.id, description, direction: input.direction, kind: input.kind, amount, accountId: account?.id ?? null, createdById: input.actorId ?? null } });
}

export async function deleteCorrection(db: Db, input: { clientId: string; correctionId: string }) {
  const c = await db.fiscalCorrection.findFirst({ where: { id: input.correctionId, taxYear: { clientId: input.clientId } } });
  if (!c) throw new LedgerError("Koreksi tidak ditemukan.");
  await yearOf(db, input.clientId, c.taxYearId);
  await db.fiscalCorrection.delete({ where: { id: c.id } });
}

/**
 * Accept a correction suggestion: the account's category (direction, kind, default %) or another %, following the account's
 * year-to-date balance × % (the pack reads it live; the stored amount is the share when accepted).
 */
export async function acceptSuggestion(db: Db, input: { clientId: string; entityId: string; year: number; accountCode: string; amount: bigint; percent?: number; actorId?: string | null }) {
  const { entity, taxYear } = await yearFor(db, input.clientId, input.entityId, input.year);
  const account = await db.account.findFirst({ where: { clientId: input.clientId, code: input.accountCode } });
  const category = account && account.type === "BEBAN" ? categoryOf(account.name) : null;
  if (!account || !category) throw new LedgerError("Usulan koreksi tidak berlaku untuk akun ini.");
  const percent = input.percent ?? category.percent;
  if (!(Number.isInteger(percent) && percent >= 1 && percent <= 100)) throw new LedgerError("Persentase koreksi 1–100.");
  const key = `nd:${account.code}`;
  if (await db.fiscalCorrection.findFirst({ where: { taxYearId: taxYear.id, suggestion: key } })) throw new LedgerError("Usulan ini sudah diterima.");
  if (input.amount <= 0n) throw new LedgerError("Akun ini tidak punya beban tahun ini.");
  return db.fiscalCorrection.create({
    data: { firmId: entity.firmId, taxYearId: taxYear.id, description: `${category.label}: ${account.name}`, direction: category.direction, kind: category.kind, amount: (input.amount * BigInt(percent) * 2n + 100n) / 200n, accountId: account.id, suggestion: key, category: category.key, percent, createdById: input.actorId ?? null },
  });
}

/** Change the % of an accepted suggestion (it follows its account × %). */
export async function setCorrectionPercent(db: Db, input: { clientId: string; correctionId: string; percent: number }) {
  const c = await db.fiscalCorrection.findFirst({ where: { id: input.correctionId, taxYear: { clientId: input.clientId } } });
  if (!c) throw new LedgerError("Koreksi tidak ditemukan.");
  if (!c.suggestion) throw new LedgerError("Persentase hanya untuk koreksi yang mengikuti saldo akun.");
  if (!(Number.isInteger(input.percent) && input.percent >= 1 && input.percent <= 100)) throw new LedgerError("Persentase koreksi 1–100.");
  await yearOf(db, input.clientId, c.taxYearId);
  return db.fiscalCorrection.update({ where: { id: c.id }, data: { percent: input.percent } });
}

export async function dismissSuggestion(db: Db, input: { clientId: string; entityId: string; year: number; key: string }) {
  if (!/^(nd:[\w.-]+|loss:\d{4})$/.test(input.key)) throw new LedgerError("Usulan tidak dikenal.");
  const { taxYear } = await yearFor(db, input.clientId, input.entityId, input.year);
  if (taxYear.dismissedSuggestions.includes(input.key)) return taxYear;
  return db.taxYear.update({ where: { id: taxYear.id }, data: { dismissedSuggestions: { push: input.key } } });
}

/**
 * Kompensasi kerugian: the loss of an origin year still unused at 1 January of the tax year (as on the prior SPT). At most five origin
 * years back; recording an origin year again replaces its amount.
 */
export async function setLoss(db: Db, input: { clientId: string; entityId: string; year: number; originYear: number; amount: string; actorId?: string | null }) {
  const { entity, taxYear } = await yearFor(db, input.clientId, input.entityId, input.year);
  if (!(Number.isInteger(input.originYear) && input.originYear < input.year && input.originYear >= input.year - 5)) throw new LedgerError(`Tahun asal rugi harus ${input.year - 5}–${input.year - 1} (kompensasi lima tahun).`);
  const amount = parseMoney(input.amount, entity.functionalCurrency);
  if (amount <= 0n) throw new LedgerError("Sisa rugi harus lebih dari nol.");
  return db.taxLossCarryforward.upsert({
    where: { taxYearId_originYear: { taxYearId: taxYear.id, originYear: input.originYear } },
    update: { amount },
    create: { firmId: entity.firmId, taxYearId: taxYear.id, originYear: input.originYear, amount, createdById: input.actorId ?? null },
  });
}

export async function deleteLoss(db: Db, input: { clientId: string; lossId: string }) {
  const l = await db.taxLossCarryforward.findFirst({ where: { id: input.lossId, taxYear: { clientId: input.clientId } } });
  if (!l) throw new LedgerError("Rugi fiskal tidak ditemukan.");
  await yearOf(db, input.clientId, l.taxYearId);
  await db.taxLossCarryforward.delete({ where: { id: l.id } });
}

export type CreditInput = { clientId: string; entityId: string; year: number; type: TaxCreditType; reference: string; date: string; amount: string; accountCode: string; actorId?: string | null };

export async function addCredit(db: Db, input: CreditInput) {
  const { entity, taxYear } = await yearFor(db, input.clientId, input.entityId, input.year);
  if (!["PPH_22", "PPH_23", "PPH_24", "OTHER"].includes(input.type)) throw new LedgerError("Pilih jenis kredit pajak.");
  const reference = input.reference.trim();
  if (!reference) throw new LedgerError("Isi nomor bukti potong.");
  const m = input.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = m ? dateOnly(Number(m[1]), Number(m[2]), Number(m[3])) : null;
  if (!date || date.getUTCMonth() + 1 !== Number(m![2])) throw new LedgerError("Tanggal bukti potong tidak valid.");
  if (date.getUTCFullYear() !== input.year) throw new LedgerError(`Tanggal bukti potong harus di tahun ${input.year}.`);
  const amount = parseMoney(input.amount, entity.functionalCurrency);
  if (amount <= 0n) throw new LedgerError("Nominal kredit pajak harus lebih dari nol.");
  const account = await db.account.findFirst({ where: { clientId: input.clientId, code: input.accountCode } });
  if (!account || account.isBank || account.isSuspense || account.isClearing || account.type !== "ASET") throw new LedgerError("Pilih akun tempat kredit pajak ini dicatat (mis. 1180 Pajak Dibayar di Muka).");
  return db.taxCredit.create({ data: { firmId: entity.firmId, taxYearId: taxYear.id, type: input.type, reference, date, amount, accountId: account.id, createdById: input.actorId ?? null } });
}

export async function deleteCredit(db: Db, input: { clientId: string; creditId: string }) {
  const c = await db.taxCredit.findFirst({ where: { id: input.creditId, taxYear: { clientId: input.clientId } } });
  if (!c) throw new LedgerError("Kredit pajak tidak ditemukan.");
  await yearOf(db, input.clientId, c.taxYearId);
  await db.taxCredit.delete({ where: { id: c.id } });
}
