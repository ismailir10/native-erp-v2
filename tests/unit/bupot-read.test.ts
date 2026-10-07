import { describe, expect, it } from "vitest";
import { kindOf, readBupot, readBupotSheets } from "@/lib/tax/bupot-read";
import type { RawCell } from "@/lib/ledger-import/types";

// Coretax bukti potong (BPPU) exports (I5d): the slips as written, their kind from the Kode Objek Pajak, and which of them count.
const sheet = (rows: RawCell[][]) => [{ name: "BPPU", rows }];
const DIBUAT_HEAD = ["Nomor Bukti Potong", "Tanggal Pemotongan", "Masa Pajak", "Tahun Pajak", "NPWP Pemotong", "NPWP/NIK Penerima Penghasilan", "Nama Penerima Penghasilan", "Kode Objek Pajak", "Dasar Pengenaan Pajak (Rp)", "Tarif (%)", "PPh Dipotong (Rp)", "Status"];

describe("readBupot", () => {
  it("reads slips the company made: the recipient is the counterparty even with the company's own NPWP as a column", () => {
    const r = readBupotSheets(sheet([
      ["Daftar Bukti Potong PPh Unifikasi"],
      DIBUAT_HEAD,
      ["2600000123", "21/08/2026", "8", "2026", "0123456789015000", "0999888777666000", "PT Konsultan Harapan", "24-104-01", 15_000_000, 2, 300_000, "NORMAL"],
      ["2600000124", "25/08/2026", "8", "2026", "0123456789015000", "0555", "Hj Rosmiati", "28-403-01", 45_000_000, 10, 4_500_000, "NORMAL-PEMBETULAN"],
      ["2600000120", "02/08/2026", "8", "2026", "0123456789015000", "0555", "Hj Rosmiati", "28-403-01", 40_000_000, 10, 4_000_000, "DIBATALKAN"],
    ]));
    expect(r.direction).toBe("DIBUAT");
    expect(r.rows.map((x) => [x.number, x.npwp, x.name, x.kind, x.dpp, x.pph, x.counted, x.sourceRef])).toEqual([
      ["2600000123", "0999888777666000", "PT Konsultan Harapan", "PPH_23", 15_000_000n, 300_000n, true, "BPPU!3"],
      ["2600000124", "0555", "Hj Rosmiati", "PPH_4_2", 45_000_000n, 4_500_000n, true, "BPPU!4"],
      ["2600000120", "0555", "Hj Rosmiati", "PPH_4_2", 40_000_000n, 4_000_000n, false, "BPPU!5"],
    ]);
  });

  it("reads slips the company received from a customer and takes the masa from the date when absent", async () => {
    const csv = ["Nomor Bukti Potong;Tanggal Bukti Potong;NPWP Pemotong;Nama Pemotong;Jenis Pajak;Penghasilan Bruto;PPh", "BP-77;14/07/2026;'0111;PT Bank Digital Nusa;PPh Pasal 23;55.000.000;1.100.000", ""].join("\n");
    const r = await readBupot("diterima.csv", Buffer.from(csv));
    expect(r.direction).toBe("DITERIMA");
    expect(r.rows[0]).toMatchObject({ number: "BP-77", npwp: "0111", name: "PT Bank Digital Nusa", kind: "PPH_23", pph: 1_100_000n, year: 2026, month: 7, counted: true });
    expect(r.notes).toEqual(["File tanpa kolom masa pajak: masa diambil dari tanggal bukti potong."]);
  });

  it("knows the kind by code or by words", () => {
    expect([kindOf("24-100-01", ""), kindOf("28-409-07", ""), kindOf("22-100-02", ""), kindOf("27-100-99", ""), kindOf("", "PPh Final Pasal 4 ayat (2)"), kindOf("", "PPh 4(2)"), kindOf("", "Pasal 22"), kindOf("", "")]).toEqual([
      "PPH_23", "PPH_4_2", "PPH_22", "PPH_26", "PPH_4_2", "PPH_4_2", "PPH_22", "LAINNYA",
    ]);
  });

  it("refuses a file that is not a slip list, a list without a counterparty side, and a duplicated number", async () => {
    await expect(readBupot("x.csv", Buffer.from("Nomor Faktur Pajak;Tanggal Faktur Pajak;Nama Pembeli;DPP;PPN\n1;01/08/2026;A;10;1\n"))).rejects.toThrow(/bukan daftar bukti potong Coretax/);
    expect(() => readBupotSheets(sheet([["Nomor Bukti Potong", "Tanggal Pemotongan", "PPh Dipotong"], ["1", "01/08/2026", 10]]))).toThrow(/tidak menyebut penerima penghasilan atau pemotong/);
    expect(() => readBupotSheets(sheet([["Nomor Bukti Potong", "Tanggal Pemotongan", "Nama Pemotong", "PPh"], ["1", "01/08/2026", "A", 10], ["1", "02/08/2026", "B", 10]]))).toThrow(/Nomor bukti potong 1 muncul lebih dari sekali \(BPPU!3\)/);
  });
});
