import { randomUUID } from "node:crypto";
import type { Db, Tx } from "@/lib/db";
import { validateNewClient, type NewClientInput } from "@/lib/onboarding";
import { createClient } from "@/lib/setup";
import { isCurrency } from "@/lib/fx/currency";
import type { EvidenceUnit } from "./types";
import { intakeForFirm, lockIntake, releaseStep } from "./store";
import { stageImport } from "@/lib/ledger-import/post";
import { importStatement } from "@/lib/import/pipeline";
import { parseStatementSections } from "@/lib/import/parsers";
import { checkContinuity } from "@/lib/import/normalize";

export async function createClientFromEvidence(db: Db, firmId: string, intakeId: string, input: NewClientInput) {
  const spec = validateNewClient(input);
  return db.$transaction(async tx => {
    await lockIntake(tx, intakeId);
    const intake = await intakeForFirm(tx, firmId, intakeId);
    if (intake.clientId) throw new Error("Dokumen sudah terhubung ke klien.");
    const { client } = await createClient(tx, firmId, spec);
    await tx.evidenceIntake.update({ where: { id: intakeId }, data: { clientId: client.id, contextVersion: { increment: 1 } } });
    return client.id;
  });
}
export async function linkClient(db: Db, firmId: string, intakeId: string, clientId: string) {
  return db.$transaction(async tx => {
    await lockIntake(tx, intakeId);
    const intake = await intakeForFirm(tx, firmId, intakeId);
    if (intake.clientId && intake.clientId !== clientId) throw new Error("Dokumen sudah terhubung ke klien lain.");
    if (!(await tx.client.findFirst({ where: { id: clientId, firmId } }))) throw new Error("Klien tidak ditemukan.");
    await tx.evidenceIntake.update({ where: { id: intakeId }, data: { clientId, contextVersion: { increment: 1 } } });
  });
}
export async function getUnit(db: Db | Tx, firmId: string, intakeId: string, versionId: string, unitKey: string) {
  const intake = await intakeForFirm(db, firmId, intakeId);
  const version = await db.evidenceVersion.findFirst({ where: { id: versionId, firmId, document: { intakeId, firmId, excluded: false, status: "READY", currentVersionId: versionId } }, include: { document: true } });
  if (!version) throw new Error("Versi sumber sudah berubah atau tidak tersedia. Periksa dokumen terbaru.");
  const unit = (version.units as unknown as EvidenceUnit[]).find(u => u.key === unitKey);
  if (!unit) throw new Error("Bagian dokumen tidak ditemukan.");
  return { intake, version, unit };
}
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(+new Date(s)) && new Date(s).toISOString().slice(0, 10) === s;
export type SelectionInput = { role: string; entityId?: string; bankAccountId?: string; periodStart?: string; periodEnd?: string; currency?: string };
export async function confirmSelection(db: Db, firmId: string, intakeId: string, versionId: string, unitKey: string, input: SelectionInput) {
  const initial = await intakeForFirm(db, firmId, intakeId);
  return db.$transaction(async tx => {
    // Coverage decisions and import claims share this lock across all client intakes.
    await lockIntake(tx, initial.clientId ?? intakeId);
    if (initial.clientId) await lockIntake(tx, intakeId);
    const { intake, unit } = await getUnit(tx, firmId, intakeId, versionId, unitKey);
    if (intake.leaseUntil && intake.leaseUntil > new Date()) throw new Error("Dokumen sedang diproses. Tunggu sebelum mengubah pilihan sumber.");
    if (!["SOURCE", "COMPARISON", "CONTEXT"].includes(input.role)) throw new Error("Pilih peran dokumen.");
    const entity = input.entityId ? await tx.entity.findFirst({ where: { id: input.entityId, firmId, clientId: intake.clientId ?? "" } }) : null;
    if (input.entityId && !entity) throw new Error("Entitas tidak ditemukan.");
    const bank = input.bankAccountId ? await tx.bankAccount.findFirst({ where: { id: input.bankAccountId, firmId, entityId: entity?.id ?? "" } }) : null;
    if (input.bankAccountId && !bank) throw new Error("Pilih rekening milik entitas sumber.");
    const current = await tx.evidenceSelection.findUnique({ where: { versionId_unitKey: { versionId, unitKey } } });
    const used = await existingImport(tx, firmId, versionId, unitKey);
    if (current?.importId || used) throw new Error("Sumber sudah digunakan. Koreksi buku melalui jurnal penyesuaian.");
    if (input.role === "SOURCE") {
      if (!entity || !validDate(input.periodStart ?? "") || !validDate(input.periodEnd ?? "") || input.periodStart! > input.periodEnd!) throw new Error("Pilih entitas dan rentang tanggal sumber pencatatan.");
      if (!input.currency || !isCurrency(input.currency)) throw new Error("Pilih mata uang sumber.");
      if (!["BANK", "LEDGER", "REPORT"].includes(unit.kind)) throw new Error("Dokumen ini belum memiliki tabel yang dapat diimpor.");
      if (unit.kind === "BANK" && !bank) throw new Error("Pilih rekening milik entitas sumber.");
      if (unit.kind !== "LEDGER" && unit.currency && unit.currency !== input.currency) throw new Error("Mata uang pilihan berbeda dengan dokumen sumber.");
      if (entity.functionalCurrency !== input.currency) throw new Error("Mata uang sumber berbeda dengan mata uang entitas. Gunakan impor manual dengan pengaturan kurs.");
      if (unit.periodStart && input.periodStart! > unit.periodStart || unit.periodEnd && input.periodEnd! < unit.periodEnd) throw new Error("Rentang sumber harus mencakup seluruh periode file.");
      const intakes = await tx.evidenceIntake.findMany({ where: { firmId, clientId: intake.clientId }, select: { id: true } });
      const overlaps = await tx.evidenceSelection.findMany({ where: { firmId, intakeId: { in: intakes.map(i => i.id) }, role: "SOURCE", confirmed: true, entityId: input.entityId, periodStart: { lte: input.periodEnd }, periodEnd: { gte: input.periodStart }, NOT: { versionId, unitKey } } });
      // Two distinct bank accounts are independent sources. A ledger covers all accounts.
      if (overlaps.some(other => !(unit.kind === "BANK" && bank && other.bankAccountId && other.bankAccountId !== bank.id))) throw new Error("Cakupan beririsan dengan sumber pencatatan yang sudah dipilih. Jadikan salah satu Pembanding atau pisahkan periodenya.");
    }
    const data = { role: input.role, entityId: entity?.id ?? null, bankAccountId: unit.kind === "BANK" ? bank?.id ?? null : null, periodStart: input.periodStart || null, periodEnd: input.periodEnd || null, currency: input.currency || null, confirmed: true };
    const selection = await tx.evidenceSelection.upsert({ where: { versionId_unitKey: { versionId, unitKey } }, create: { firmId, intakeId, versionId, unitKey, ...data }, update: data });
    await tx.evidenceIntake.update({ where: { id: intakeId }, data: { contextVersion: { increment: 1 } } });
    return selection;
  });
}
async function existingImport(db: Db | Tx, firmId: string, versionId: string, unitKey: string) {
  const where = { firmId, evidenceVersionId: versionId, evidenceUnitKey: unitKey };
  return await db.statementImport.findFirst({ where, select: { id: true } }) ?? await db.ledgerImport.findFirst({ where, select: { id: true } });
}
async function withImportLease<T>(db: Db, firmId: string, intakeId: string, work: () => Promise<T>) {
  const initial = await intakeForFirm(db, firmId, intakeId);
  const token = randomUUID();
  await db.$transaction(async tx => {
    await lockIntake(tx, initial.clientId ?? intakeId);
    if (initial.clientId) await lockIntake(tx, intakeId);
    await intakeForFirm(tx, firmId, intakeId);
    const claimed = await tx.evidenceIntake.updateMany({ where: { id: intakeId, firmId, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, data: { leaseToken: token, leaseUntil: new Date(Date.now() + 180_000) } });
    if (!claimed.count) throw new Error("Dokumen sedang diproses sesi lain. Tunggu sampai selesai.");
  });
  try { return await work(); } finally { await releaseStep(db, firmId, intakeId, token); }
}
export async function decideFact(db: Db, firmId: string, intakeId: string, factId: string, accept: boolean) {
  await intakeForFirm(db, firmId, intakeId);
  return db.$transaction(async tx => {
    await lockIntake(tx, intakeId);
    const fact = await tx.evidenceFact.findFirst({ where: { id: factId, firmId, intakeId } });
    if (!fact) throw new Error("Konteks tidak ditemukan.");
    await tx.evidenceFact.update({ where: { id: factId }, data: { status: accept ? "CONFIRMED" : "REJECTED" } });
    await tx.evidenceIntake.update({ where: { id: intakeId }, data: { contextVersion: { increment: 1 } } });
  });
}
export async function resolveConflict(db: Db, firmId: string, intakeId: string, conflictId: string, note: string) {
  await intakeForFirm(db, firmId, intakeId);
  if (note.trim().length < 8 || note.length > 1000) throw new Error("Catat alasan pemilihan sumber (8–1.000 karakter).");
  const conflict = await db.evidenceConflict.findFirst({ where: { id: conflictId, firmId, intakeId } });
  if (!conflict) throw new Error("Perbedaan tidak ditemukan.");
  await db.evidenceConflict.update({ where: { id: conflict.id }, data: { resolved: true, note: note.trim() } });
}

async function prepare(db: Db, firmId: string, intakeId: string, versionId: string, unitKey: string, bankAccountId?: string, password?: string) {
  const { intake, version, unit } = await getUnit(db, firmId, intakeId, versionId, unitKey);
  const selection = await db.evidenceSelection.findFirst({ where: { versionId, unitKey, firmId, intakeId } });
  if (!intake.clientId || !selection?.confirmed || selection.role !== "SOURCE" || !selection.entityId || !selection.periodStart || !selection.periodEnd || !selection.currency) throw new Error("Konfirmasi klien, entitas, dan peran Sumber pencatatan terlebih dahulu.");
  const used = await existingImport(db, firmId, versionId, unitKey);
  if (selection.importId || used) {
    const importId = selection.importId ?? used!.id;
    await db.evidenceSelection.update({ where: { id: selection.id }, data: { importId } });
    return { kind: unit.kind, importId, already: true };
  }
  if (unit.scale !== "1") throw new Error("Skala angka sumber bukan satuan penuh atau belum pasti. Siapkan file dalam satuan penuh sebelum mengimpor; analisis dokumen tetap tersedia.");
  const entity = await db.entity.findFirst({ where: { id: selection.entityId, firmId, clientId: intake.clientId } });
  if (!entity || selection.currency !== entity.functionalCurrency) throw new Error("Entitas atau mata uang sumber tidak sesuai.");
  const conflicts = await db.evidenceConflict.findMany({ where: { firmId, intakeId, resolved: false } });
  if (conflicts.some(c => (c.versionIds as string[]).includes(versionId))) throw new Error("Selesaikan perbedaan sumber terkait sebelum menyiapkan impor.");
  if (unit.kind === "BANK") {
    if (bankAccountId && bankAccountId !== selection.bankAccountId) throw new Error("Rekening berubah. Konfirmasi ulang pilihan sumber terlebih dahulu.");
    const bank = await db.bankAccount.findFirst({ where: { id: selection.bankAccountId ?? "", firmId, entityId: entity.id } });
    if (!bank) throw new Error("Pilih rekening milik entitas sumber.");
    if (selection.currency !== "IDR") throw new Error("Rekening koran valuta asing tersedia sebagai bukti; pencatatan bank belum didukung.");
    const sections = await parseStatementSections(version.name, Buffer.from(version.data), { password });
    const digits = (value: string | null) => (value ?? "").replace(/\D/g, "");
    const st = sections.find(s => digits(s.accountNumber) === digits(bank.number)) ?? (sections.length === 1 && !sections[0].accountNumber ? sections[0] : null);
    if (!st) throw new Error("Nomor rekening tidak ditemukan pada file atau berbeda dengan rekening terpilih.");
    if ((st.section?.currency ?? "IDR") !== selection.currency) throw new Error("Mata uang rekening di file berbeda dengan pilihan sumber.");
    const dates = [st.periodStart, st.periodEnd, ...st.rows.map(row => row.date)].map(date => date.toISOString().slice(0, 10));
    if (dates.some(date => date < selection.periodStart! || date > selection.periodEnd!)) throw new Error("Rentang sumber harus mencakup seluruh periode file.");
    const locked = await db.period.findMany({ where: { firmId, clientId: intake.clientId, status: "LOCKED" }, select: { year: true, month: true } });
    if (st.rows.some(row => locked.some(p => p.year === row.date.getUTCFullYear() && p.month === row.date.getUTCMonth() + 1))) throw new Error("Periode sumber sudah ditutup. Buka periode terlebih dahulu.");
    const continuity = checkContinuity(st);
    return { kind: "BANK", rows: st.rows.length, continuityOk: continuity.ok, bankAccountId: bank.id };
  }
  try {
    const staged = await stageImport(db, { firmId, clientId: intake.clientId, fileName: version.name, data: Buffer.from(version.data), sheet: unit.label, entityId: entity.id, date: new Date(selection.periodEnd), evidenceVersionId: versionId, evidenceUnitKey: unitKey, allowedPeriod: { start: selection.periodStart, end: selection.periodEnd, currency: selection.currency, entityId: entity.id } });
    if (staged.status !== "STAGED") throw new Error("Tabel sumber belum dapat dipilih. Gunakan impor manual untuk memilih sheet.");
    await db.evidenceSelection.update({ where: { id: selection.id }, data: { importId: staged.importId } });
    return { kind: unit.kind, importId: staged.importId };
  } catch (error) {
    // A competing request may win the unique evidence key after our initial lookup.
    const found = await existingImport(db, firmId, versionId, unitKey);
    if (!found) throw error;
    await db.evidenceSelection.update({ where: { id: selection.id }, data: { importId: found.id } });
    return { kind: unit.kind, importId: found.id, already: true };
  }
}
export async function prepareImport(db: Db, firmId: string, intakeId: string, versionId: string, unitKey: string, bankAccountId?: string, password?: string) {
  return withImportLease(db, firmId, intakeId, () => prepare(db, firmId, intakeId, versionId, unitKey, bankAccountId, password));
}
export async function postEvidenceBank(db: Db, firmId: string, intakeId: string, versionId: string, unitKey: string, bankAccountId: string, password?: string) {
  return withImportLease(db, firmId, intakeId, async () => {
    if ((await getUnit(db, firmId, intakeId, versionId, unitKey)).unit.kind !== "BANK") throw new Error("Sumber bukan rekening koran.");
    const preview = await prepare(db, firmId, intakeId, versionId, unitKey, bankAccountId, password);
    if (preview.kind !== "BANK") throw new Error("Sumber bukan rekening koran.");
    if (preview.already) return preview.importId!;
    const { version } = await getUnit(db, firmId, intakeId, versionId, unitKey);
    let importId: string;
    try {
      // Existing deterministic pipeline remains the sole writer; AI suggestions are reviewed later.
      const result = await importStatement(db, { bankAccountId: preview.bankAccountId!, fileName: version.name, data: Buffer.from(version.data), provider: null, password, evidenceVersionId: versionId, evidenceUnitKey: unitKey });
      importId = result.importId;
    } catch (error) {
      const found = await db.statementImport.findFirst({ where: { firmId, evidenceVersionId: versionId, evidenceUnitKey: unitKey } });
      if (!found) throw error;
      importId = found.id;
    }
    await db.evidenceSelection.update({ where: { versionId_unitKey: { versionId, unitKey } }, data: { importId } });
    return importId;
  });
}
