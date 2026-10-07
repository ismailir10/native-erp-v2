import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { importStatement } from "@/lib/import/pipeline";
import { reviewTransaction } from "@/lib/review";
import { bupotNotes, bupotRecon, deleteBupot, importBupot } from "@/lib/tax/bupot";
import { runControls } from "@/lib/controls";
import { masaReport } from "@/lib/tax/masa-report";
import { masaWorkbook } from "@/lib/tax/masa-workbook";
import ExcelJS from "exceljs";

// Bukti potong Unifikasi (I5d): Coretax slips against the withholding on bank lines of the masa, matched one to one on the exact PPh.
type G = Awaited<ReturnType<typeof makeGroup>>;
let g: G;

beforeEach(async () => {
  await resetDb();
  g = await makeGroup();
  const csv = [
    "Tanggal;Keterangan;Debet;Kredit;Saldo",
    "01/08/2026;SALDO AWAL;;;500000000",
    "05/08/2026;TRSF CR PT BANK DIGITAL NUSA;0;53900000;553900000",
    "21/08/2026;JASA KONSULTAN HARAPAN;14700000;0;539200000",
    "25/08/2026;SEWA RUKO HJ ROSMIATI;40500000;0;498700000",
    "27/08/2026;JASA KEBERSIHAN CEMERLANG;980000;0;497720000",
    "",
  ].join("\n");
  await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca-agu.csv", data: Buffer.from(csv), provider: null });
  const line = (text: string) => db.bankTransaction.findFirstOrThrow({ where: { description: { contains: text } } });
  const review = async (text: string, accountCode: string, kind: "PPH_23" | "PPH_4_2", amount: bigint) =>
    reviewTransaction(db, { bankTxId: (await line(text)).id, accountCode, taxTag: null, withholding: { kind, amount } });
  await review("BANK DIGITAL", "4110", "PPH_23", 1_100_000n);
  await review("KONSULTAN", "6170", "PPH_23", 300_000n);
  await review("ROSMIATI", "6120", "PPH_4_2", 4_500_000n);
  await review("KEBERSIHAN", "6190", "PPH_23", 20_000n);
});

const DIBUAT = (cancelLast = false) =>
  [
    "Nomor Bukti Potong;Tanggal Pemotongan;Masa Pajak;Tahun Pajak;NPWP/NIK Penerima Penghasilan;Nama Penerima Penghasilan;Kode Objek Pajak;Dasar Pengenaan Pajak (Rp);PPh Dipotong (Rp);Status",
    "2600000123;21/08/2026;8;2026;0999;PT Konsultan Harapan;24-104-01;15000000;300000;NORMAL",
    // Filed as PPh 23 although the books withheld 4(2): the amount matches, the kind does not.
    "2600000124;25/08/2026;8;2026;0555;Hj Rosmiati;24-100-01;45000000;4500000;NORMAL",
    `2600000125;28/08/2026;8;2026;0777;CV Lain;24-104-01;2500000;50000;${cancelLast ? "DIBATALKAN" : "NORMAL"}`,
    "",
  ].join("\n");
const DITERIMA = ["Nomor Bukti Potong;Tanggal Bukti Potong;NPWP Pemotong;Nama Pemotong;Kode Objek Pajak;Penghasilan Bruto;PPh", "BP-77;05/08/2026;0111;PT Bank Digital Nusa;24-104-01;55000000;1100000", ""].join("\n");
const imp = (csv: string) => importBupot(db, { clientId: g.client.id, entityId: g.pt.entity.id, fileName: "bupot.csv", data: Buffer.from(csv) });
const recon = () => bupotRecon(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month: 8 });

describe("bukti potong Unifikasi", () => {
  it("matches slips to the withholding, names a slip not booked, a withholding without a slip and a slip of another kind", async () => {
    expect(await imp(DIBUAT())).toMatchObject({ direction: "DIBUAT", created: 3 });
    const d = (await recon()).directions[0];
    expect(d).toMatchObject({ direction: "DIBUAT", imported: 3, slipPph: 4_850_000n, bookPph: 4_820_000n, difference: 30_000n, status: "DIFF" });
    expect(d.matched.map((m) => [m.slip.number, m.book.description])).toEqual([
      ["2600000123", "JASA KONSULTAN HARAPAN"],
      ["2600000124", "SEWA RUKO HJ ROSMIATI"],
    ]);
    expect(d.kindDiffers.map((m) => m.slip.number)).toEqual(["2600000124"]);
    expect(d.unmatchedSlips.map((s) => s.number)).toEqual(["2600000125"]);
    expect(d.unmatchedBook.map((b) => [b.description, b.pph])).toEqual([["JASA KEBERSIHAN CEMERLANG", 20_000n]]);
    expect(bupotNotes(await recon())).toEqual([
      "Bukti potong dibuat: PPh Rp 4.850.000 vs buku Rp 4.820.000; 1 bukti potong tanpa pemotongan di buku, 1 pemotongan di buku tanpa bukti potong, 1 beda jenis (2600000124: PPh 23 vs PPh 4(2)).",
    ]);

    // The masa workbook's Bukti Potong sheet carries the comparison.
    const rep = (await masaReport(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month: 8 }))!;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await masaWorkbook(rep, { firm: "KJA Uji", title: "PT Uji" }, undefined, await recon())) as unknown as ArrayBuffer);
    const cells = wb.getWorksheet("Bukti Potong")!.getSheetValues().flat().map(String);
    expect(cells).toEqual(expect.arrayContaining(["Cocokkan dengan Coretax", "Bukti potong 2600000125 tanpa pemotongan di buku", "JASA KEBERSIHAN CEMERLANG: pemotongan di buku tanpa bukti potong", "Bukti potong 2600000124: PPh 23, di buku PPh 4(2)"]));

    // A customer's slip ties to the receipt it withheld from.
    expect(await imp(DITERIMA)).toMatchObject({ direction: "DITERIMA", created: 1 });
    expect((await recon()).directions[1]).toMatchObject({ slipPph: 1_100_000n, bookPph: 1_100_000n, status: "MATCH", unmatchedSlips: [], unmatchedBook: [] });
  });

  it("updates a slip cancelled since, flags the masa on Tutup Buku, and removes a masa's slips", async () => {
    await imp(DIBUAT());
    expect(await imp(DIBUAT(true))).toMatchObject({ created: 0, updated: 1, unchanged: 2 });
    expect((await recon()).directions[0].notCounted.map((s) => s.number)).toEqual(["2600000125"]);
    const control = async () => (await runControls(db, g.client.id, 2026, 8)).find((c) => c.key === `bupot:${g.pt.entity.id}`);
    expect(await control()).toMatchObject({ title: "Bukti potong Coretax = buku", status: "REVIEW" });
    expect(await deleteBupot(db, { clientId: g.client.id, entityId: g.pt.entity.id, direction: "DIBUAT", year: 2026, month: 8 })).toBe(3);
    expect(await control()).toBeUndefined();
  });

  it("refuses an individual's books", async () => {
    await expect(importBupot(db, { clientId: g.client.id, entityId: g.owner.entity.id, fileName: "b.csv", data: Buffer.from(DITERIMA) })).rejects.toThrow("Bukti potong Coretax hanya untuk badan usaha (PT/CV) dengan pembukuan Rupiah.");
  });
});
