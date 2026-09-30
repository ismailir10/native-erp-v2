import type { Db, Tx } from "@/lib/db";
import { cleanBank, OnboardingError, takenNumbers, TAKEN, type BankInput } from "@/lib/onboarding";

/**
 * Rename and remove companies/owners and bank accounts of an existing client (the caller checks the role: removal is admin only).
 *
 * Names are labels: a rename never touches a journal, a period or a figure (only the bank GL account names, which are built from
 * `label (shortName)`). Removal is for something entered by mistake: anything a posted entry, a bank row, an import or a register
 * points to stays (accounting-rules 3, posted entries are immutable) and is refused with the reason. The foreign keys are the last
 * line of defence: a delete that races a concurrent write fails instead of cascading.
 */
export class EntityEditError extends Error {}

export type Usage = { label: string; n: number }[];

const nonzero = (rows: [string, number][]): Usage => rows.filter(([, n]) => n > 0).map(([label, n]) => ({ label, n }));

/** What still points at a bank account (its GL account and its statements). Empty = removable. */
export async function bankAccountUsage(db: Db | Tx, bankAccountId: string): Promise<Usage> {
  const ba = await db.bankAccount.findUnique({ where: { id: bankAccountId }, select: { accountId: true, account: { select: { code: true } }, entity: { select: { clientId: true } } } });
  if (!ba) return [];
  const { accountId } = ba;
  const [imports, rows, lines, sources, credits, corrections, invoices, schedules, assets, classified] = await Promise.all([
    db.statementImport.count({ where: { bankAccountId } }),
    db.bankTransaction.count({ where: { bankAccountId } }),
    db.journalLine.count({ where: { accountId } }),
    db.sourceAccount.count({ where: { accountId } }),
    db.taxCredit.count({ where: { accountId } }),
    db.fiscalCorrection.count({ where: { accountId } }),
    db.invoice.count({ where: { OR: [{ counterAccountId: accountId }, { arApAccountId: accountId }] } }),
    db.adjustmentSchedule.count({ where: { OR: [{ debitAccountId: accountId }, { creditAccountId: accountId }, { sourceAccountId: accountId }] } }),
    db.fixedAsset.count({ where: { OR: [{ assetAccountId: accountId }, { accumulatedAccountId: accountId }] } }),
    db.bankTransaction.count({ where: { bankAccount: { entity: { clientId: ba.entity.clientId } }, OR: [{ accountCode: ba.account.code }, { suggestedCode: ba.account.code }] } }),
  ]);
  return nonzero([
    ["impor rekening koran", imports],
    ["mutasi bank", rows],
    ["baris jurnal", lines],
    ["pemetaan akun dari impor buku besar", sources],
    ["kredit pajak", credits],
    ["koreksi fiskal", corrections],
    ["faktur", invoices],
    ["jadwal penyesuaian", schedules],
    ["aset tetap", assets],
    ["mutasi yang diklasifikasikan ke akun ini", classified],
  ]);
}

/** What still points at a company/owner, its bank accounts included. Empty = removable. */
export async function entityUsage(db: Db | Tx, entityId: string): Promise<Usage> {
  const banks = await db.bankAccount.findMany({ where: { entityId }, select: { id: true } });
  const byEntity = { entityId };
  const [entries, rows, imports, sources, schedules, proposals, assets, invoices, taxYears, ckpn, leases, employees, benefitSetting, benefitPostings, selections] = await Promise.all([
    db.journalEntry.count({ where: byEntity }),
    db.bankTransaction.count({ where: byEntity }),
    db.statementImport.count({ where: { bankAccount: { entityId } } }),
    db.sourceAccount.count({ where: byEntity }),
    db.adjustmentSchedule.count({ where: byEntity }),
    db.proposedEntry.count({ where: byEntity }),
    db.fixedAsset.count({ where: byEntity }),
    db.invoice.count({ where: byEntity }),
    db.taxYear.count({ where: byEntity }),
    db.ckpnSetting.count({ where: byEntity }),
    db.lease.count({ where: byEntity }),
    db.employee.count({ where: byEntity }),
    db.benefitSetting.count({ where: byEntity }),
    db.benefitPosting.count({ where: byEntity }),
    db.evidenceSelection.count({ where: byEntity }),
  ]);
  const own = nonzero([
    ["jurnal (termasuk saldo awal)", entries],
    ["mutasi bank", rows],
    ["impor rekening koran", imports],
    ["akun dari impor buku besar", sources],
    ["jadwal penyesuaian", schedules],
    ["usulan jurnal", proposals],
    ["aset tetap", assets],
    ["faktur", invoices],
    ["tahun pajak", taxYears],
    ["pengaturan CKPN", ckpn],
    ["sewa", leases],
    ["karyawan", employees],
    ["pengaturan imbalan kerja", benefitSetting],
    ["posting imbalan kerja", benefitPostings],
    ["dokumen yang dikonfirmasi untuk perusahaan ini", selections],
  ]);
  // Bank accounts add only what the entity's own totals can't show (a mapping, a tax credit, a row classified to its code, …):
  // their statements, rows and journal lines are already counted above.
  const counted = new Set(["impor rekening koran", "mutasi bank", "baris jurnal"]);
  const seen = new Set(own.map((u) => u.label));
  for (const b of banks) for (const u of await bankAccountUsage(db, b.id)) if (!counted.has(u.label) && !seen.has(u.label)) { own.push(u); seen.add(u.label); }
  return own;
}

const plural = (u: Usage) => u.map((x) => `${x.n} ${x.label}`).join(", ");

/** The sentence shown next to a disabled *Hapus* (and in the refusal), or null when nothing blocks. */
export function blockedReason(kind: "entity" | "bank", usage: Usage): string | null {
  if (!usage.length) return null;
  return kind === "entity"
    ? `Sudah ada ${plural(usage)}. Pembukuan yang sudah tercatat tidak bisa dihapus; koreksi lewat Jurnal Penyesuaian.`
    : `Sudah ada ${plural(usage)}. Rekening yang sudah dipakai tidak bisa dihapus.`;
}

const isForeignKeyError = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2003";
const raced = (what: string) => (e: unknown): never => {
  if (isForeignKeyError(e)) throw new EntityEditError(`${what} baru saja dipakai (mutasi atau jurnal masuk saat dihapus), jadi tidak dihapus. Muat ulang halaman.`);
  throw e;
};

/** One-line label of a bank GL account: what createBankAccount() writes. */
export const glName = (label: string, shortName: string) => `${label} (${shortName})`;

export async function renameEntity(db: Db, input: { firmId: string; clientId: string; entityId: string; name: string; shortName: string; npwp: string }) {
  const entity = await db.entity.findFirst({ where: { id: input.entityId, clientId: input.clientId, firmId: input.firmId }, include: { bankAccounts: { select: { accountId: true, label: true } } } });
  if (!entity) throw new OnboardingError({ entity: "Perusahaan tidak ditemukan di klien ini." });
  const fields: Record<string, string> = {};
  const name = input.name.trim();
  if (!name) fields.name = entity.kind === "PERORANGAN" ? "Isi nama pemilik." : "Isi nama badan usaha.";
  else if (name.length > 120) fields.name = "Nama maksimal 120 karakter.";
  const shortName = input.shortName.trim() || name;
  if (shortName.length > 60) fields.shortName = "Nama singkat maksimal 60 karakter.";
  const npwp = entity.kind === "BADAN_USAHA_ASING" ? "" : input.npwp.trim();
  if (npwp && !/^[\d.\-\s]{15,25}$/.test(npwp)) fields.npwp = "NPWP berisi 15 atau 16 angka, boleh dengan titik dan strip.";
  // The ledger import matches file rows to entities by short name: two with the same one would make that ambiguous.
  if (!fields.shortName) {
    const siblings = await db.entity.findMany({ where: { clientId: input.clientId, id: { not: entity.id } }, select: { shortName: true } });
    if (siblings.some((s) => s.shortName.trim().toLowerCase() === shortName.toLowerCase())) fields.shortName = "Nama singkat ini sudah dipakai perusahaan lain di klien ini.";
  }
  if (Object.keys(fields).length) throw new OnboardingError(fields);
  return db.$transaction(async (tx) => {
    const updated = await tx.entity.update({ where: { id: entity.id }, data: { name, shortName, npwp: npwp || null } });
    for (const b of entity.bankAccounts) await tx.account.update({ where: { id: b.accountId }, data: { name: glName(b.label, shortName) } });
    return updated;
  });
}

export async function updateBankAccount(db: Db, input: { firmId: string; clientId: string; bankAccountId: string; label: string; bank: BankInput["bank"]; number: string }) {
  const ba = await db.bankAccount.findFirst({ where: { id: input.bankAccountId, entity: { clientId: input.clientId, firmId: input.firmId } }, include: { entity: { select: { shortName: true } } } });
  if (!ba) throw new OnboardingError({ bankAccountId: "Rekening tidak ditemukan di klien ini." });
  const fields: Record<string, string> = {};
  const taken = await takenNumbers(db, input.clientId);
  taken.delete(ba.number); // its own number is not a duplicate
  const clean = cleanBank({ bank: input.bank, number: input.number, label: input.label, isOverdraft: ba.isOverdraft }, "bank", fields, taken, TAKEN);
  if (!clean && !Object.keys(fields).length) fields["bank.number"] = "Isi nomor rekening.";
  if (Object.keys(fields).length || !clean) throw new OnboardingError(fields);
  const label = clean.label; // blank input = the same default name as at creation
  const identityChanged = clean.number !== ba.number || clean.bank !== ba.bank;
  if (identityChanged) {
    // The number is what statements are matched against: once anything was imported it stays.
    const [imports, rows] = await Promise.all([db.statementImport.count({ where: { bankAccountId: ba.id } }), db.bankTransaction.count({ where: { bankAccountId: ba.id } })]);
    if (imports || rows) throw new OnboardingError({ "bank.number": "Rekening ini sudah punya mutasi yang diimpor, jadi bank dan nomornya tidak bisa diubah (file berikutnya dicocokkan dengan nomor ini). Ubah namanya saja, atau tambahkan rekening baru." });
  }
  return db.$transaction(async (tx) => {
    const updated = await tx.bankAccount.update({ where: { id: ba.id }, data: { label, bank: clean.bank, number: clean.number } });
    await tx.account.update({ where: { id: ba.accountId }, data: { name: glName(label, ba.entity.shortName) } });
    return updated;
  });
}

export async function removeBankAccount(db: Db, input: { firmId: string; clientId: string; bankAccountId: string }) {
  const ba = await db.bankAccount.findFirst({ where: { id: input.bankAccountId, entity: { clientId: input.clientId, firmId: input.firmId } }, select: { id: true, accountId: true, label: true } });
  if (!ba) throw new EntityEditError("Rekening tidak ditemukan di klien ini.");
  return db
    .$transaction(async (tx) => {
      const reason = blockedReason("bank", await bankAccountUsage(tx, ba.id));
      if (reason) throw new EntityEditError(reason);
      await tx.bankAccount.delete({ where: { id: ba.id } });
      await tx.account.delete({ where: { id: ba.accountId } });
      return { label: ba.label };
    })
    .catch(raced("Rekening ini"));
}

export async function removeEntity(db: Db, input: { firmId: string; clientId: string; entityId: string }) {
  const entity = await db.entity.findFirst({ where: { id: input.entityId, clientId: input.clientId, firmId: input.firmId }, select: { id: true, name: true, bankAccounts: { select: { id: true, accountId: true } } } });
  if (!entity) throw new EntityEditError("Perusahaan tidak ditemukan di klien ini.");
  return db
    .$transaction(async (tx) => {
      if ((await tx.entity.count({ where: { clientId: input.clientId } })) < 2) throw new EntityEditError("Klien harus punya minimal satu perusahaan atau pemilik. Kalau seluruh klien salah dimasukkan, hapus kliennya (admin).");
      const reason = blockedReason("entity", await entityUsage(tx, entity.id));
      if (reason) throw new EntityEditError(reason);
      const banks = entity.bankAccounts;
      // Control acknowledgements are keyed by "<control>:<entity or bank id>"; an empty company has none worth keeping.
      const keys = [entity.id, ...banks.map((b) => b.id)];
      await tx.controlAck.deleteMany({ where: { period: { clientId: input.clientId }, OR: keys.map((k) => ({ controlKey: { endsWith: `:${k}` } })) } });
      await tx.bankAccount.deleteMany({ where: { entityId: entity.id } });
      await tx.account.deleteMany({ where: { id: { in: banks.map((b) => b.accountId) } } });
      await tx.entity.delete({ where: { id: entity.id } });
      return { name: entity.name, bankAccounts: banks.length };
    })
    .catch(raced("Perusahaan ini"));
}
