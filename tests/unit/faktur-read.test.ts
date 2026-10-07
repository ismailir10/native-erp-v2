import { describe, expect, it } from "vitest";
import { readFaktur, readFakturSheets } from "@/lib/tax/faktur-read";
import { dateOnly } from "@/lib/format";
import type { RawCell } from "@/lib/ledger-import/types";

// Coretax faktur exports (I5c): the rows as written, which of them count toward the masa, and why.
const KELUARAN_HEAD = ["NPWP Pembeli / Identitas lainnya", "Nama Pembeli", "Kode Transaksi", "Nomor Faktur Pajak", "Tanggal Faktur Pajak", "Masa Pajak", "Tahun", "Status Faktur", "ESignStatus", "Harga Jual/Penggantian/DPP", "DPP Nilai Lain/DPP", "PPN", "PPnBM", "Referensi", "Dilaporkan oleh Penjual"];
const sheet = (rows: RawCell[][]) => [{ name: "Faktur", rows }];

describe("readFaktur — Coretax keluaran", () => {
  it("reads the keluaran list under its title rows, counts approved faktur and keeps a cancelled one as written", () => {
    const r = readFakturSheets(sheet([
      ["Daftar Faktur Pajak Keluaran"],
      ["PT Ayam Nusantara Digital"],
      [],
      KELUARAN_HEAD,
      ["0123456789015000", "PT Mitra Unggas Sentosa", "04", "04002600000000101", "05/08/2026", "8", "2026", "APPROVED", "Signed", 300_000_000, 275_000_000, 33_000_000, 0, "INV-81", "Ya"],
      ["0123456789015000", "PT Mitra Unggas Sentosa", "04", "04002600000000102", "2026-08-20", "Agustus", "2026", "CANCELLED", "Signed", "100.000.000", "91.666.667", "11.000.000", 0, "INV-82", "Ya"],
    ]));
    expect(r.direction).toBe("KELUARAN");
    expect(r.rows.map((x) => [x.number, x.month, x.year, x.ppn, x.counted, x.sourceRef])).toEqual([
      ["04002600000000101", 8, 2026, 33_000_000n, true, "Faktur!5"],
      ["04002600000000102", 8, 2026, 11_000_000n, false, "Faktur!6"],
    ]);
    expect(r.rows[0]).toMatchObject({ name: "PT Mitra Unggas Sentosa", npwp: "0123456789015000", dpp: 300_000_000n, date: dateOnly(2026, 8, 5), status: "APPROVED" });
  });

  it("takes the masa from the faktur date when the file has no masa column, rounds sen per faktur and says so", () => {
    const r = readFakturSheets(sheet([
      ["Nomor Faktur", "Tanggal Faktur", "Nama Pembeli", "DPP", "PPN"],
      ["010.000-26.00000001", "31/07/2026", "CV Berkah", "1.000.000,50", "110.000,49"],
    ]));
    expect(r.rows[0]).toMatchObject({ year: 2026, month: 7, dpp: 1_000_001n, ppn: 110_000n, counted: true });
    expect(r.notes).toEqual([
      "1 faktur memuat sen; dibulatkan ke Rupiah penuh per faktur.",
      "File tanpa kolom status: semua faktur dihitung.",
      "File tanpa kolom masa pajak: masa diambil dari tanggal faktur.",
    ]);
  });
});

describe("readFaktur — Coretax masukan", () => {
  it("counts only credited input faktur and flags approved ones not yet credited", () => {
    const r = readFakturSheets(sheet([
      ["NPWP Penjual", "Nama Penjual", "Nomor Faktur Pajak", "Tanggal Faktur Pajak", "Masa Pajak", "Tahun", "Status Faktur", "Harga Jual/Penggantian/DPP", "PPN"],
      ["0222", "PT Pakan Jaya", "04002600000000501", "03/08/2026", "08", "2026", "CREDITED", 100_000_000, 11_000_000],
      ["0222", "PT Pakan Jaya", "04002600000000502", "10/08/2026", "08", "2026", "APPROVED", 50_000_000, 5_500_000],
      ["0333", "PT Bibit", "04002600000000503", "12/08/2026", "08", "2026", "Faktur Diganti", 20_000_000, 2_200_000],
    ]));
    expect(r.direction).toBe("MASUKAN");
    expect(r.rows.map((x) => [x.number, x.counted, x.uncredited])).toEqual([
      ["04002600000000501", true, false],
      ["04002600000000502", false, true],
      ["04002600000000503", false, false],
    ]);
  });
});

describe("readFaktur — refusals", () => {
  it("refuses a file that is not a faktur list, one without a counterparty side, and a duplicated number", async () => {
    await expect(readFaktur("x.csv", Buffer.from("Tanggal;Keterangan;Debet;Kredit;Saldo\n01/08/2026;X;1;0;1\n"))).rejects.toThrow(/bukan daftar faktur Coretax/);
    expect(() => readFakturSheets(sheet([["Nomor Faktur", "Tanggal Faktur", "DPP", "PPN"], ["1", "01/08/2026", 10, 1]]))).toThrow(/tidak menyebut pembeli atau penjual/);
    expect(() => readFakturSheets(sheet([["Nomor Faktur", "Tanggal Faktur", "Nama Pembeli", "DPP", "PPN"], ["1", "01/08/2026", "A", 10, 1], ["1", "02/08/2026", "B", 10, 1]]))).toThrow(/Nomor faktur 1 muncul lebih dari sekali \(Faktur!3\)/);
    expect(() => readFakturSheets(sheet([["Nomor Faktur", "Tanggal Faktur", "Nama Pembeli", "DPP", "PPN"], ["1", "kemarin", "A", 10, 1]]))).toThrow(/Faktur!2: tanggal faktur "kemarin" tidak terbaca/);
  });

  it("reads a semicolon CSV export the same way", async () => {
    const csv = ["Nomor Faktur Pajak;Tanggal Faktur Pajak;NPWP Pembeli;Nama Pembeli;Status Faktur;Harga Jual/Penggantian/DPP;PPN", "04002600000000101;05/08/2026;'0123;PT A;APPROVED;300000000;33000000", ""].join("\n");
    const r = await readFaktur("keluaran.csv", Buffer.from(csv));
    expect(r.rows[0]).toMatchObject({ number: "04002600000000101", npwp: "0123", ppn: 33_000_000n, counted: true });
  });
});
