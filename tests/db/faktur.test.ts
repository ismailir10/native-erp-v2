import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { importStatement } from "@/lib/import/pipeline";
import { createInvoice } from "@/lib/receivables/invoices";
import { deleteFaktur, fakturNotes, fakturRecon, importFaktur } from "@/lib/tax/faktur";
import { runControls } from "@/lib/controls";

// Ekualisasi PPN (I5c): Coretax faktur against the PPN the books hold for the masa, matched one to one on the exact PPN.
type G = Awaited<ReturnType<typeof makeGroup>>;
let g: G;

beforeEach(async () => {
  await resetDb();
  g = await makeGroup();
  await db.rule.create({ data: { firmId: g.firm.id, clientId: g.client.id, pattern: "MITRA", direction: "IN", accountCode: "4100", taxTag: "PPN_KELUARAN", priority: 50, source: "USER" } });
  const csv = [
    "Tanggal;Keterangan;Debet;Kredit;Saldo",
    "01/08/2026;SALDO AWAL;;;500000000",
    "05/08/2026;TRSF CR PT MITRA UNGGAS SENTOSA;0;111000000;611000000",
    "12/08/2026;TRSF CR CV MITRA BARU;0;33300000;644600000",
    "14/08/2026;TRSF DB PT PAKAN JAYA;55500000;0;589100000",
    "15/08/2026;SETORAN PPN MASA DJP;1000000;0;588100000",
    "",
  ].join("\n");
  await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca-agu.csv", data: Buffer.from(csv), provider: null });
  await createInvoice(db, { clientId: g.client.id, entityId: g.pt.entity.id, direction: "SALES", contactName: "PT Mitra Unggas Sentosa", contactNpwp: "01.234.567.8-015.000", number: "INV-081", issueDate: "2026-08-20", dueDate: "2026-09-19", dpp: "10.000.000", ppn: "1.100.000", counterCode: "4100" });
});

const KELUARAN = (cancelF3 = false) =>
  [
    "Nomor Faktur Pajak;Tanggal Faktur Pajak;Masa Pajak;Tahun;NPWP Pembeli;Nama Pembeli;Status Faktur;Harga Jual/Penggantian/DPP;PPN",
    "04002600000000001;05/08/2026;8;2026;0123456780150000;PT Mitra Unggas Sentosa;APPROVED;100000000;11000000",
    "04002600000000002;20/08/2026;8;2026;0123456780150000;PT Mitra Unggas Sentosa;APPROVED;10000000;1100000",
    `04002600000000003;25/08/2026;8;2026;0999;CV Sumber Lain;${cancelF3 ? "CANCELLED" : "APPROVED"};20000000;2200000`,
    "04002600000000004;26/08/2026;8;2026;0999;CV Sumber Lain;CANCELLED;50000000;5000000",
    "",
  ].join("\n");
const MASUKAN = ["NPWP Penjual;Nama Penjual;Nomor Faktur Pajak;Tanggal Faktur Pajak;Masa Pajak;Tahun;Status Faktur;Harga Jual/Penggantian/DPP;PPN", "0555;PT Pakan Jaya;07002600000000009;14/08/2026;8;2026;CREDITED;50000000;5500000", ""].join("\n");
const imp = (csv: string, entityId = g.pt.entity.id) => importFaktur(db, { clientId: g.client.id, entityId, fileName: "faktur.csv", data: Buffer.from(csv) });
const recon = () => fakturRecon(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month: 8 });

describe("ekualisasi PPN", () => {
  it("matches faktur to the bank line and the invoice, and names the faktur not booked and the PPN booked without a faktur", async () => {
    expect(await imp(KELUARAN())).toMatchObject({ direction: "KELUARAN", created: 4, updated: 0, masas: [{ year: 2026, month: 8, count: 4 }] });
    const k = (await recon()).directions[0];
    // Books: 11.000.000 (receipt) + 3.300.000 (receipt, no faktur) + 1.100.000 (invoice); the remittance is a payment, not PPN of the masa.
    expect(k).toMatchObject({ direction: "KELUARAN", imported: 4, fakturPpn: 14_300_000n, bookPpn: 15_400_000n, difference: -1_100_000n, status: "DIFF" });
    expect(k.matched.map((m) => [m.faktur.number, m.book.kind, m.book.label])).toEqual([
      ["04002600000000001", "BANK", "TRSF CR PT MITRA UNGGAS SENTOSA"],
      ["04002600000000002", "INVOICE", "INV-081 · PT Mitra Unggas Sentosa"],
    ]);
    expect(k.unmatchedFaktur.map((f) => f.number)).toEqual(["04002600000000003"]);
    expect(k.unmatchedBook.map((b) => [b.label, b.ppn])).toEqual([["TRSF CR CV MITRA BARU", 3_300_000n]]);
    expect(k.notCounted.map((f) => f.number)).toEqual(["04002600000000004"]);
    expect(fakturNotes(await recon())).toEqual(["Faktur keluaran: PPN faktur Rp 14.300.000 vs buku Rp 15.400.000 (selisih Rp 1.100.000); 1 faktur belum ada di buku, 1 PPN di buku tanpa faktur."]);

    // Masukan: the credited faktur ties to the PAKAN purchase split by the rule.
    expect(await imp(MASUKAN)).toMatchObject({ direction: "MASUKAN", created: 1 });
    expect((await recon()).directions[1]).toMatchObject({ fakturPpn: 5_500_000n, bookPpn: 5_500_000n, difference: 0n, status: "MATCH", unmatchedFaktur: [], unmatchedBook: [] });
  });

  it("updates a faktur cancelled since the last export, and the close control flags the masa until faktur and books agree", async () => {
    await imp(KELUARAN());
    expect(await imp(KELUARAN(true))).toMatchObject({ created: 0, updated: 1, unchanged: 3 });
    const k = (await recon()).directions[0];
    expect(k).toMatchObject({ fakturPpn: 12_100_000n, unmatchedFaktur: [] });
    expect(k.notCounted.map((f) => f.number)).toEqual(["04002600000000003", "04002600000000004"]);
    const control = async () => (await runControls(db, g.client.id, 2026, 8)).find((c) => c.key === `faktur:${g.pt.entity.id}`);
    expect(await control()).toMatchObject({ title: "Faktur Coretax = buku", status: "REVIEW" });
    expect((await control())!.detail).toMatch(/^Faktur keluaran: PPN faktur Rp 12\.100\.000 vs buku Rp 15\.400\.000/);
    // Removing the masa's keluaran faktur takes the control away with them (no faktur imported, nothing to compare).
    expect(await deleteFaktur(db, { clientId: g.client.id, entityId: g.pt.entity.id, direction: "KELUARAN", year: 2026, month: 8 })).toBe(4);
    expect(await control()).toBeUndefined();
    expect((await recon()).any).toBe(false);
    const audit = await db.auditEvent.findMany({ where: { kind: "FAKTUR" }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.summary)).toEqual([
      "Faktur keluaran PT Uji dari faktur.csv: 4 baru, 0 berubah (Agustus 2026)",
      "Faktur keluaran PT Uji dari faktur.csv: 0 baru, 1 berubah (Agustus 2026)",
      "Faktur keluaran PT Uji masa Agustus 2026 dihapus (4 faktur)",
    ]);
  });

  it("refuses an individual's books and another client's company", async () => {
    await expect(imp(KELUARAN(), g.owner.entity.id)).rejects.toThrow("Faktur Coretax hanya untuk badan usaha (PT/CV) dengan pembukuan Rupiah.");
    const other = await db.client.create({ data: { firmId: g.firm.id, name: "Klien Lain" } });
    await expect(importFaktur(db, { clientId: other.id, entityId: g.pt.entity.id, fileName: "f.csv", data: Buffer.from(KELUARAN()) })).rejects.toThrow("Perusahaan tidak ditemukan di klien ini.");
  });
});
