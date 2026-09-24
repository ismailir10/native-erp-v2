import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { db, makeGroup, resetDb } from "../helpers";
import { confirmSelection, linkClient, postEvidenceBank, prepareImport } from "@/lib/evidence/review";
import { createIntake, hash, json } from "@/lib/evidence/store";
import type { EvidenceUnit } from "@/lib/evidence/types";
import { createClient } from "@/lib/setup";

beforeEach(resetDb);
const bankFile = (account = "1111111111") => Buffer.from(`Informasi Rekening - Mutasi Rekening
No. rekening : ${account}
Periode : 01/08/2026 - 31/08/2026
Tanggal Transaksi,Keterangan,Cabang,Jumlah,,Saldo
'01/08,"BIAYA ADM",'0000,"100.00",DB,"900.00"
"Saldo Awal : 1,000.00"
"Saldo Akhir : 900.00"
`);
async function ledgerFile(extraEntity = false, currency = "IDR") {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("GL");
  ws.addRow(["Entity", "Entry Date", "Account Code", "Account Name", "Currency", "Debit", "Credit", "Notes"]);
  ws.addRow(["PT Uji", "01/08/2026", "1", "Kas", currency, 100, 0, ""]);
  ws.addRow(["PT Uji", "01/08/2026", "2", "Modal Saham", currency, 0, 100, ""]);
  if (extraEntity) { ws.addRow(["Andi", "01/08/2026", "1", "Kas", currency, 100, 0, ""]); ws.addRow(["Andi", "01/08/2026", "2", "Modal Saham", currency, 0, 100, ""]); }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
async function setup() {
  const g = await makeGroup();
  const intake = await createIntake(db, g.firm.id, g.client.id);
  return { ...g, intake };
}
async function source(g: Awaited<ReturnType<typeof setup>>, kind: "BANK" | "LEDGER", data?: Buffer) {
  const bytes = data ?? bankFile();
  const unit: EvidenceUnit = { key: "u1", label: kind === "BANK" ? "Mutasi" : "GL", kind, role: "SOURCE", entity: "PT Uji", periodStart: "2026-08-01", periodEnd: "2026-08-31", currency: "IDR", scale: "1", passages: [], figures: [], facts: [], issues: [] };
  const doc = await db.evidenceDocument.create({ data: { firmId: g.firm.id, intakeId: g.intake.id, sourceKey: crypto.randomUUID(), name: kind === "BANK" ? "bank.csv" : "gl.xlsx", path: "test", mimeType: "", status: "READY" } });
  const version = await db.evidenceVersion.create({ data: { firmId: g.firm.id, documentId: doc.id, hash: hash(bytes), data: new Uint8Array(bytes), name: doc.name, size: bytes.length, extracted: true, units: json([unit]) } });
  await db.evidenceDocument.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
  return { doc, version, unit };
}
const selection = (g: Awaited<ReturnType<typeof setup>>, bankAccountId?: string) => ({ role: "SOURCE", entityId: g.pt.entity.id, bankAccountId, periodStart: "2026-08-01", periodEnd: "2026-08-31", currency: "IDR" });

describe("evidence source review and import handoff", () => {
  it("requires explicit confirmation and performs bank posting only after explicit action", async () => {
    const g = await setup(), s = await source(g, "BANK");
    await expect(prepareImport(db, g.firm.id, g.intake.id, s.version.id, "u1", g.pt.banks[0].id)).rejects.toThrow("Konfirmasi");
    await confirmSelection(db, g.firm.id, g.intake.id, s.version.id, "u1", selection(g, g.pt.banks[0].id));
    const preview = await prepareImport(db, g.firm.id, g.intake.id, s.version.id, "u1", g.pt.banks[0].id);
    expect(preview).toMatchObject({ kind: "BANK", rows: 1, continuityOk: true });
    expect(await db.journalEntry.count()).toBe(0);
    const id = await postEvidenceBank(db, g.firm.id, g.intake.id, s.version.id, "u1", g.pt.banks[0].id);
    expect(await db.statementImport.findUnique({ where: { id } })).toMatchObject({ evidenceVersionId: s.version.id, evidenceUnitKey: "u1" });
    expect(await db.journalEntry.count()).toBe(1);
    expect(await postEvidenceBank(db, g.firm.id, g.intake.id, s.version.id, "u1", g.pt.banks[0].id)).toBe(id);
    expect(await db.statementImport.count()).toBe(1);
    await expect(confirmSelection(db, g.firm.id, g.intake.id, s.version.id, "u1", { role: "COMPARISON" })).rejects.toThrow("sudah digunakan");
  });
  it("prevents cross-client and foreign-firm selection or account substitution", async () => {
    const g = await setup(), s = await source(g, "BANK");
    const other = await db.$transaction(tx => createClient(tx, g.firm.id, { name: "Other", industry: "other", entities: [{ name: "Other PT", shortName: "Other", kind: "PT", banks: [] }] }));
    await expect(confirmSelection(db, g.firm.id, g.intake.id, s.version.id, "u1", { ...selection(g), entityId: other.entities[0].entity.id })).rejects.toThrow("Entitas");
    await expect(confirmSelection(db, g.firm.id, g.intake.id, s.version.id, "u1", selection(g, g.owner.banks[0].id))).rejects.toThrow("rekening");
    await expect(confirmSelection(db, "foreign", g.intake.id, s.version.id, "u1", selection(g, g.pt.banks[0].id))).rejects.toThrow("tidak ditemukan");
    await expect(linkClient(db, g.firm.id, g.intake.id, other.client.id)).rejects.toThrow("klien lain");
    await confirmSelection(db, g.firm.id, g.intake.id, s.version.id, "u1", selection(g, g.pt.banks[0].id));
    await expect(prepareImport(db, g.firm.id, g.intake.id, s.version.id, "u1", g.pt.banks[1].id)).rejects.toThrow("Rekening berubah");
  });
  it("allows distinct bank accounts, blocks same bank and ledger overlap across intakes", async () => {
    const g = await setup(), first = await source(g, "BANK"), second = await source(g, "BANK", bankFile("2222222222"));
    await confirmSelection(db, g.firm.id, g.intake.id, first.version.id, "u1", selection(g, g.pt.banks[0].id));
    await confirmSelection(db, g.firm.id, g.intake.id, second.version.id, "u1", selection(g, g.pt.banks[1].id));
    const g2 = { ...g, intake: await createIntake(db, g.firm.id, g.client.id) };
    const duplicate = await source(g2, "BANK"), ledger = await source(g2, "LEDGER", await ledgerFile());
    await expect(confirmSelection(db, g.firm.id, g2.intake.id, duplicate.version.id, "u1", selection(g, g.pt.banks[0].id))).rejects.toThrow("beririsan");
    await expect(confirmSelection(db, g.firm.id, g2.intake.id, ledger.version.id, "u1", selection(g))).rejects.toThrow("beririsan");
    await confirmSelection(db, g.firm.id, g2.intake.id, ledger.version.id, "u1", { role: "COMPARISON", entityId: g.pt.entity.id });
  });
  it("rejects wrong bank number and mismatched date coverage before posting", async () => {
    const g = await setup(), s = await source(g, "BANK", bankFile("9999999999"));
    await expect(confirmSelection(db, g.firm.id, g.intake.id, s.version.id, "u1", { ...selection(g, g.pt.banks[0].id), periodStart: "2026-08-02" })).rejects.toThrow("seluruh periode");
    await confirmSelection(db, g.firm.id, g.intake.id, s.version.id, "u1", selection(g, g.pt.banks[0].id));
    await expect(prepareImport(db, g.firm.id, g.intake.id, s.version.id, "u1")).rejects.toThrow("Nomor rekening");
    expect(await db.journalEntry.count()).toBe(0);
  });
  it("rejects bank source in locked period without journals", async () => {
    const g = await setup(), s = await source(g, "BANK");
    await confirmSelection(db, g.firm.id, g.intake.id, s.version.id, "u1", selection(g, g.pt.banks[0].id));
    await db.period.create({ data: { firmId: g.firm.id, clientId: g.client.id, year: 2026, month: 8, status: "LOCKED" } });
    await expect(postEvidenceBank(db, g.firm.id, g.intake.id, s.version.id, "u1", g.pt.banks[0].id)).rejects.toThrow("ditutup");
    expect(await db.journalEntry.count()).toBe(0);
  });
  it("stages ledger once, preserves source reference, and freezes used selection", async () => {
    const g = await setup(), s = await source(g, "LEDGER", await ledgerFile());
    await confirmSelection(db, g.firm.id, g.intake.id, s.version.id, "u1", selection(g));
    const staged = await prepareImport(db, g.firm.id, g.intake.id, s.version.id, "u1");
    expect(staged.importId).toBeTruthy();
    expect(await db.ledgerImport.findFirst()).toMatchObject({ evidenceVersionId: s.version.id, evidenceUnitKey: "u1", status: "DRAFT" });
    expect((await prepareImport(db, g.firm.id, g.intake.id, s.version.id, "u1")).importId).toBe(staged.importId);
    expect(await db.ledgerImport.count()).toBe(1);
    expect(await db.journalEntry.count()).toBe(0);
    await expect(confirmSelection(db, g.firm.id, g.intake.id, s.version.id, "u1", { role: "COMPARISON" })).rejects.toThrow("sudah digunakan");
  });
  it("concurrent prepare clicks create one draft and leave ledger currency semantics unchanged", async () => {
    const g = await setup(), s = await source(g, "LEDGER", await ledgerFile(false, "USD"));
    await confirmSelection(db, g.firm.id, g.intake.id, s.version.id, "u1", selection(g));
    const outcomes = await Promise.allSettled([prepareImport(db, g.firm.id, g.intake.id, s.version.id, "u1"), prepareImport(db, g.firm.id, g.intake.id, s.version.id, "u1")]);
    expect(outcomes.filter(r => r.status === "fulfilled").length).toBeGreaterThan(0);
    expect(await db.ledgerImport.count()).toBe(1);
    expect(await db.ledgerImport.findFirst()).toMatchObject({ currencyMode: "FUNCTIONAL" });
    expect(await db.journalEntry.count()).toBe(0);
  });
  it("rejects parsed ledger dates or entities outside confirmed coverage before staging", async () => {
    const g = await setup(), s = await source(g, "LEDGER", await ledgerFile(true));
    await confirmSelection(db, g.firm.id, g.intake.id, s.version.id, "u1", selection(g));
    await expect(prepareImport(db, g.firm.id, g.intake.id, s.version.id, "u1")).rejects.toThrow("entitas lain");
    expect(await db.ledgerImport.count()).toBe(0);
    expect(await db.sourceAccount.count()).toBe(0);
    await db.evidenceSelection.update({ where: { versionId_unitKey: { versionId: s.version.id, unitKey: "u1" } }, data: { periodStart: "2026-08-02" } });
    await expect(prepareImport(db, g.firm.id, g.intake.id, s.version.id, "u1")).rejects.toThrow("seluruh periode");
  });
  it("refuses scaled source amounts rather than posting raw thousands as Rupiah", async () => {
    const g = await setup(), s = await source(g, "LEDGER", await ledgerFile());
    await db.evidenceVersion.update({ where: { id: s.version.id }, data: { units: json([{ ...s.unit, scale: "1000" }]) } });
    await confirmSelection(db, g.firm.id, g.intake.id, s.version.id, "u1", selection(g));
    await expect(prepareImport(db, g.firm.id, g.intake.id, s.version.id, "u1")).rejects.toThrow("Skala angka");
    expect(await db.ledgerImport.count()).toBe(0);
    expect(await db.journalEntry.count()).toBe(0);
  });

});
