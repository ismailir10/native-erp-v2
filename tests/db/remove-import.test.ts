import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { db, makeGroup, resetDb } from "../helpers";
import { importStatement } from "@/lib/import/pipeline";
import { reviewTransaction } from "@/lib/review";
import { removeLedgerImport, removeStatementImport, RemoveImportError } from "@/lib/imports/remove";
import { importSourceAccounts, postImport, stageImport } from "@/lib/ledger-import/post";
import { acceptMappings, suggestMappings } from "@/lib/ledger-import/mapping";
import { trialBalance } from "@/lib/reports/ledger";
import { listEvents } from "@/lib/audit";
import { createAsset } from "@/lib/assets/register";
import { dateOnly } from "@/lib/format";

/** ADR 0013 / UC-K4: removing an import takes everything it put in the books, the reports return to before, the file imports again. */
const file = (month: string, opening: string, ...rows: string[]) => Buffer.from(["Tanggal;Keterangan;Debet;Kredit;Saldo", `01/${month}/2026;SALDO AWAL;;;${opening}`, ...rows, ""].join("\n"));
const july = file("07", "100.000.000,00", "05/07/2026;TRSF E-BANKING DB TOKO SUMBER MAKMUR;2.000.000,00;0,00;98.000.000,00", "20/07/2026;TRSF E-BANKING CR CV PELANGGAN JAYA;0,00;5.000.000,00;103.000.000,00");
const august = file("08", "103.000.000,00", "04/08/2026;TRSF E-BANKING DB TOKO SUMBER MAKMUR;3.000.000,00;0,00;100.000.000,00", "06/08/2026;PINDAH BUKU KE MANDIRI PT UJI SEJAHTERA;10.000.000,00;0,00;90.000.000,00", "21/08/2026;TRSF E-BANKING CR CV PELANGGAN JAYA;0,00;7.500.000,00;97.500.000,00");
const mandiriAug = file("08", "0,00", "06/08/2026;PINDAH BUKU DARI BCA PT UJI SEJAHTERA;0,00;10.000.000,00;10.000.000,00");

async function setup() {
  const g = await makeGroup();
  const admin = await db.firmMember.create({ data: { firmId: g.firm.id, userId: randomUUID(), email: `admin-${randomUUID()}@example.test`, name: "Admin Uji", role: "ADMIN" } });
  return { g, admin: { id: admin.id, role: "ADMIN" as const } };
}
const tb = async (clientId: string, entityId: string) =>
  (await trialBalance(db, { clientId, entityIds: [entityId] }, dateOnly(2026, 8, 31))).filter((r) => r.net !== 0n).map((r) => [r.account.code, r.net.toString()]);

describe("hapus impor rekening koran", () => {
  beforeEach(resetDb);

  it("returns the books exactly to before the file, logs what it took, unlinks a transfer partner, and the file imports again", async () => {
    const { g, admin } = await setup();
    const [bca, mdr] = g.pt.banks;
    await importStatement(db, { bankAccountId: bca.id, fileName: "bca-jul.csv", data: july, provider: null });
    await importStatement(db, { bankAccountId: mdr.id, fileName: "mdr-agu.csv", data: mandiriAug, provider: null });
    const before = await tb(g.client.id, g.pt.entity.id);
    const linesBefore = await db.bankTransaction.count();

    await importStatement(db, { bankAccountId: bca.id, fileName: "bca-agu.csv", data: august, provider: null });
    const aug = await db.statementImport.findFirstOrThrow({ where: { fileName: "bca-agu.csv" } });
    const pending = await db.bankTransaction.findFirstOrThrow({ where: { importId: aug.id, status: "NEEDS_REVIEW" } });
    await reviewTransaction(db, { bankTxId: pending.id, accountCode: "6120", taxTag: null }); // a RECLASS on top of the BANK entry
    const partner = await db.bankTransaction.findFirstOrThrow({ where: { bankAccountId: mdr.id } });
    expect(partner.matchedTxId).not.toBeNull();

    const r = await removeStatementImport(db, { clientId: g.client.id, importId: aug.id, reason: "File Agustus salah rekening", actor: admin });
    expect(r).toMatchObject({ rows: 3, partnersUnlinked: 1 });
    expect(await db.bankTransaction.count()).toBe(linesBefore);
    expect(await db.statementImport.count({ where: { id: aug.id } })).toBe(0);
    // The Mandiri half keeps its account (1199) and only loses the link: the clearing control shows it open.
    expect(await tb(g.client.id, g.pt.entity.id)).toEqual(before);
    expect((await db.bankTransaction.findUniqueOrThrow({ where: { id: partner.id } })).matchedTxId).toBeNull();

    const [event] = await listEvents(db, g.client.id, { kind: "IMPORT_REMOVED" });
    expect(event.summary).toMatch(/^Impor bca-agu\.csv \(BCA Giro · 1111111111, 1 Agu 2026 – 31 Agu 2026\) dihapus: 3 mutasi, 4 jurnal\. Alasan: File Agustus salah rekening$/);
    expect(event.actor).toBe("Admin Uji");
    expect(event.before).toMatchObject({ rows: 3, moneyIn: "Rp 7.500.000", moneyOut: "Rp 13.000.000", journals: 4, partnersUnlinked: 1 });

    const again = await importStatement(db, { bankAccountId: bca.id, fileName: "bca-agu.csv", data: august, provider: null });
    expect([again.rows, again.duplicates]).toEqual([3, 0]);
  });

  it("refuses an accountant, a short reason, a closed month and a journal something else rests on", async () => {
    const { g, admin } = await setup();
    const bca = g.pt.banks[0];
    await importStatement(db, { bankAccountId: bca.id, fileName: "bca-jul.csv", data: july, provider: null });
    const imp = await db.statementImport.findFirstOrThrow();
    const base = { clientId: g.client.id, importId: imp.id };
    await expect(removeStatementImport(db, { ...base, reason: "Salah rekening sekali", actor: { id: admin.id, role: "AKUNTAN" } })).rejects.toThrow("Hanya admin kantor yang dapat menghapus impor.");
    await expect(removeStatementImport(db, { ...base, reason: "salah", actor: admin })).rejects.toThrow(/min\. 10 karakter/);

    await db.period.update({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month: 7 } }, data: { status: "LOCKED" } });
    await expect(removeStatementImport(db, { ...base, reason: "Salah rekening sekali", actor: admin })).rejects.toThrow(/Bulan Juli 2026 sudah ditutup/);
    await db.period.update({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month: 7 } }, data: { status: "OPEN" } });

    const entry = await db.journalEntry.findFirstOrThrow({ where: { bankTransaction: { importId: imp.id } } });
    const acc = async (code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
    await db.adjustmentSchedule.create({ data: { firmId: g.firm.id, clientId: g.client.id, entityId: g.pt.entity.id, kind: "AMORTIZATION", memo: "Sewa dibayar di muka", debitAccountId: await acc("6120"), creditAccountId: await acc("1170"), amount: 2_000_000n, months: 2, startYear: 2026, startMonth: 7, sourceEntryId: entry.id } });
    await expect(removeStatementImport(db, { ...base, reason: "Salah rekening sekali", actor: admin })).rejects.toThrow(/dipakai oleh jadwal "Sewa dibayar di muka"/);
    expect(await db.bankTransaction.count({ where: { importId: imp.id } })).toBe(2);
    await expect(removeStatementImport(db, { ...base, reason: "Salah rekening sekali", actor: admin })).rejects.toBeInstanceOf(RemoveImportError);
  });

  it("a review racing the removal never leaves a journal without its bank line behind", async () => {
    const { g, admin } = await setup();
    const bca = g.pt.banks[0];
    await importStatement(db, { bankAccountId: bca.id, fileName: "bca-agu.csv", data: august, provider: null });
    const aug = await db.statementImport.findFirstOrThrow();
    const lines = await db.bankTransaction.findMany({ where: { importId: aug.id } });
    await Promise.allSettled([
      removeStatementImport(db, { clientId: g.client.id, importId: aug.id, reason: "File Agustus salah rekening", actor: admin }),
      ...lines.map((t) => reviewTransaction(db, { bankTxId: t.id, accountCode: "6120", taxTag: null, learn: false })),
    ]);
    expect(await db.journalEntry.count({ where: { entityId: g.pt.entity.id, kind: { in: ["BANK", "RECLASS"] }, bankTransactionId: null } })).toBe(0);
    expect(await db.journalEntry.count({ where: { entityId: g.pt.entity.id } })).toBe(0);
  });

  it("refuses when the transfer's other half sits in a closed month: its clearing control would change after the fact", async () => {
    const { g, admin } = await setup();
    const [bca, mdr] = g.pt.banks;
    const bcaJul = file("07", "100.000.000,00", "31/07/2026;PINDAH BUKU KE MANDIRI PT UJI SEJAHTERA;10.000.000,00;0,00;90.000.000,00");
    const mdrAug = file("08", "0,00", "03/08/2026;PINDAH BUKU DARI BCA PT UJI SEJAHTERA;0,00;10.000.000,00;10.000.000,00");
    await importStatement(db, { bankAccountId: bca.id, fileName: "bca-jul.csv", data: bcaJul, provider: null });
    await importStatement(db, { bankAccountId: mdr.id, fileName: "mdr-agu.csv", data: mdrAug, provider: null });
    const half = await db.bankTransaction.findFirstOrThrow({ where: { bankAccountId: bca.id } });
    expect(half.matchedTxId).not.toBeNull();
    const aug = await db.statementImport.findFirstOrThrow({ where: { fileName: "mdr-agu.csv" } });

    await db.period.update({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month: 7 } }, data: { status: "LOCKED" } });
    await expect(removeStatementImport(db, { clientId: g.client.id, importId: aug.id, reason: "File Agustus salah rekening", actor: admin })).rejects.toThrow(/Pasangan transfer .* Juli 2026 yang sudah ditutup/);
    expect((await db.bankTransaction.findUniqueOrThrow({ where: { id: half.id } })).matchedTxId).not.toBeNull();
  });
});

describe("hapus impor buku besar", () => {
  beforeEach(resetDb);

  it("removes a posted ledger file with its journals and keeps the source-account mapping for the next file", async () => {
    const { g, admin } = await setup();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("GL");
    ws.addRow(["Entity", "Entry Date", "Account Code", "Account Name", "Currency", "Debit", "Credit", "Notes"]);
    ws.addRow(["PT Uji", new Date(Date.UTC(2026, 6, 31)), "60001", "Beban Gaji", "IDR", 5_000_000, 0, ""]);
    ws.addRow(["PT Uji", new Date(Date.UTC(2026, 6, 31)), "21001", "Utang Gaji", "IDR", 0, 5_000_000, ""]);
    const staged = await stageImport(db, { firmId: g.firm.id, clientId: g.client.id, fileName: "gl.xlsx", data: Buffer.from(await wb.xlsx.writeBuffer()) });
    if (staged.status !== "STAGED") throw new Error("not staged");
    await suggestMappings(db, { firmId: g.firm.id, clientId: g.client.id, provider: null, useAi: false });
    const src = await importSourceAccounts(db, staged.importId);
    await acceptMappings(db, g.client.id, src.map((s) => ({ sourceAccountId: s.id, accountCode: s.name.startsWith("Beban") ? "6100" : "2150", method: "MANUAL" as const })));
    await postImport(db, g.client.id, staged.importId);
    expect(await tb(g.client.id, g.pt.entity.id)).toEqual([["2150", "-5000000"], ["6100", "5000000"]]);

    const r = await removeLedgerImport(db, { clientId: g.client.id, importId: staged.importId, reason: "File GL versi lama, diganti", actor: admin });
    expect(r.journals).toBe(1);
    expect(await tb(g.client.id, g.pt.entity.id)).toEqual([]);
    expect(await db.sourceAccount.count({ where: { clientId: g.client.id, accountId: { not: null } } })).toBe(2);
    expect((await listEvents(db, g.client.id))[0]).toMatchObject({ kind: "IMPORT_REMOVED", before: { mode: "LEDGER", journals: 1, nets: { "6100 Beban Gaji & Tunjangan": "Rp 5.000.000", "2150 Beban Masih Harus Dibayar": "-Rp 5.000.000" } } });
  });

  it("refuses a Saldo Awal file while a fixed asset from before the books stands on it, and removes it once the asset is gone", async () => {
    const { g, admin } = await setup();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Neraca");
    const rows = [
      ["PT UJI"], ["Balance Sheet"], ["31/05/2026"], ["(in IDR)"], ["Date", null, "31/05/2026"],
      ["Assets"], ["Fixed Assets"], ["1-1500", "Peralatan Kantor", 30_000_000], ["Total Fixed Assets", null, 30_000_000], ["Total Assets", null, 30_000_000],
      ["Liability & Equity"], ["Current Liability"], ["2-2000", "Accounts Payable", 10_000_000], ["Total Current Liability", null, 10_000_000],
      ["Equity"], ["3-3000", "Share Capital", 20_000_000], ["Total Liability & Equity", null, 30_000_000],
    ];
    for (const r of rows) ws.addRow(r);
    const staged = await stageImport(db, { firmId: g.firm.id, clientId: g.client.id, fileName: "neraca.xlsx", data: Buffer.from(await wb.xlsx.writeBuffer()), entityId: g.pt.entity.id, date: dateOnly(2026, 5, 31) });
    if (staged.status !== "STAGED") throw new Error("not staged");
    const src = await importSourceAccounts(db, staged.importId);
    await acceptMappings(db, g.client.id, src.map((s) => ({ sourceAccountId: s.id, accountCode: ({ "Peralatan Kantor": "1210", "Accounts Payable": "2110" } as Record<string, string>)[s.name] ?? "3100", method: "MANUAL" as const })));
    await postImport(db, g.client.id, staged.importId);

    const asset = await createAsset(db, { clientId: g.client.id, entityId: g.pt.entity.id, taxGroup: "KELOMPOK_1", fiscalMethod: "GARIS_LURUS", assetAccountCode: "1210", name: "Printer lama", acquiredOn: "2020-01-10", cost: "30000000", openingAccumulated: "30000000" });
    const remove = () => removeLedgerImport(db, { clientId: g.client.id, importId: staged.importId, reason: "Neraca versi lama, diganti", actor: admin });
    await expect(remove()).rejects.toThrow(/Saldo Awal dari impor ini dipakai oleh aset tetap "Printer lama"/);
    expect(await tb(g.client.id, g.pt.entity.id)).toEqual([["1210", "30000000"], ["2110", "-10000000"], ["3100", "-20000000"]]);

    await db.fixedAsset.delete({ where: { id: asset.id } });
    await remove();
    expect(await tb(g.client.id, g.pt.entity.id)).toEqual([]);
  });
});
