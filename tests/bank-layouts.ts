import type { BankCode } from "@/lib/generated/prisma/enums";
import { BAL, CLOSE, MON_EN, OPEN, TX, bniDirectCsv, bniDirectXlsx, cimbOctoCsv, en, idn, mandiriLivinXlsx, p2, permataCsv, xlsxBuffer } from "./bank-fixture";

/**
 * One synthetic file per bank export Buku claims to read (`lib/banks.ts` formats), each holding the same five August 2026
 * transactions of a made-up company (`tests/bank-fixture.ts`), laid out as that bank documents it. `tests/unit/bank-layouts.test.ts`
 * reads every one (same rows, signs, dates, opening/closing, continuous balance, tagged with the bank) and
 * `tests/unit/bank-coverage.test.ts` fails when a bank lists a format with no layout here. Names and numbers are fake.
 */
export type Layout = {
  bank: BankCode;
  /** The `BankFormat.label` in `lib/banks.ts` this file stands for. */
  format: string;
  file: string;
  build: () => Buffer | Promise<Buffer>;
};

const q = (s: string) => `"${s}"`;
const text = (t: (typeof TX)[number]) => t.desc.join(" ");
const abs = (v: number) => Math.abs(v);
/** 1234567 → "1234567.00" (no thousands separator). */
const plain = (v: number) => `${abs(v)}.00`;

export const LAYOUTS: Layout[] = [
  {
    bank: "BCA",
    format: "KlikBCA Bisnis (CSV)",
    file: "klikbca-bisnis-2026.csv",
    // Current export: every field quoted, full dates, the direction inside the amount cell, the summary after the rows.
    build: () =>
      Buffer.from(
        [
          q("Informasi Rekening - Mutasi Rekening"),
          q("No. rekening : 0000012345"),
          q("Nama : PT CONTOH FIKTIF"),
          q("Periode : 01/08/2026 - 31/08/2026"),
          q("Kode Mata Uang : Rp"),
          "",
          [q("Tanggal Transaksi"), q("Keterangan"), q("Cabang"), q("Jumlah"), q("Saldo")].join(","),
          ...TX.map((t, i) => [q(`${p2(t.d)}/08/2026`), q(`${text(t)}   `), q("0000"), q(`${en(t.amt)} ${t.amt < 0 ? "DB" : "CR"}`), q(en(BAL[i]))].join(",")),
          "",
          q(`Saldo Awal : ${en(OPEN)}`),
          [q(`Mutasi Debet : ${en(TX.filter((t) => t.amt < 0).reduce((s, t) => s - t.amt, 0))}`), q("3")].join(","),
          [q(`Mutasi Kredit : ${en(TX.filter((t) => t.amt > 0).reduce((s, t) => s + t.amt, 0))}`), q("2")].join(","),
          q(`Saldo Akhir : ${en(CLOSE)}`),
        ].join("\n"),
      ),
  },
  {
    bank: "BCA",
    format: "KlikBCA Individual (CSV)",
    file: "klikbca-individual.csv",
    // Unquoted descriptions with commas, `'dd/mm/yyyy`, plain amounts, CR/DB in the unlabeled column, `=` metadata and trailer.
    build: () =>
      Buffer.from(
        [
          "Account No.,=,'0000012345",
          "Name,=,PT CONTOH FIKTIF",
          "Currency,=,IDR",
          "",
          "Date,Description,Branch,Amount,,Balance",
          ...TX.map((t, i) => `'${p2(t.d)}/08/2026,${t.desc.join(", ")},0000,${plain(t.amt)},${t.amt < 0 ? "DB" : "CR"},${plain(BAL[i])}`),
          "",
          `Starting Balance,=,${plain(OPEN)}`,
          `Credit,=,${plain(TX.filter((t) => t.amt > 0).reduce((s, t) => s + t.amt, 0))}`,
          `Debet,=,${plain(TX.filter((t) => t.amt < 0).reduce((s, t) => s - t.amt, 0))}`,
          `Ending Balance,=,${plain(CLOSE)}`,
        ].join("\n"),
      ),
  },

  // ---- Mandiri ----
  { bank: "MANDIRI", format: "Livin' / MCM (Excel)", file: "mandiri-livin.xlsx", build: mandiriLivinXlsx },
  {
    bank: "MANDIRI",
    format: "Kopra / MCM (CSV)",
    file: "mandiri-kopra.csv",
    // MCM / Kopra account statement: Posting Date "01 Aug 2026 10:15:30", Remark, Reference, separate Debit / Credit, en numbers.
    build: () =>
      Buffer.from(
        [
          "Mandiri Cash Management - Account Statement",
          "Account No,1370000123456",
          "Account Name,PT CONTOH FIKTIF",
          "Period,01/08/2026 - 31/08/2026",
          "",
          "Posting Date,Remark,Reference No,Debit,Credit,Balance",
          ...TX.map((t, i) => `${q(`${p2(t.d)} Aug 2026 10:15:30`)},${q(text(t))},${q(`REF${7000 + i}`)},${q(t.amt < 0 ? en(t.amt) : "0.00")},${q(t.amt > 0 ? en(t.amt) : "0.00")},${q(en(BAL[i]))}`),
          `Opening Balance,${q(en(OPEN))}`,
          `Closing Balance,${q(en(CLOSE))}`,
        ].join("\n"),
      ),
  },
  // ---- BRI ----
  {
    bank: "BRI",
    format: "BRImo / CMS (CSV)",
    file: "bri-cms.csv",
    build: () =>
      Buffer.from(
        [
          "NOREK;000001000123509",
          "TGL_TRAN;DESK_TRAN;MUTASI_DEBET;MUTASI_KREDIT;SALDO_AKHIR_MUTASI",
          ...TX.map((t, i) => `2026-08-${p2(t.d)};${text(t)};${t.amt < 0 ? abs(t.amt) : 0};${t.amt > 0 ? t.amt : 0};${BAL[i]}`),
        ].join("\n"),
      ),
  },
  {
    bank: "BRI",
    format: "internet banking (CSV)",
    file: "bri-ib.csv",
    build: () =>
      Buffer.from(
        [
          "PT. BANK RAKYAT INDONESIA (PERSERO) Tbk.",
          "Laporan Mutasi Rekening",
          "No. Rekening : 0000-01-000123-50-9",
          "",
          "Tanggal Transaksi,Uraian Transaksi,Teller,Debet,Kredit,Saldo",
          ...TX.map((t, i) => `${p2(t.d)}/08/26,${q(text(t))},0000123,${q(t.amt < 0 ? idn(t.amt) : "0,00")},${q(t.amt > 0 ? idn(t.amt) : "0,00")},${q(idn(BAL[i]))}`),
        ].join("\n"),
      ),
  },
  {
    bank: "BRI",
    format: "QLola (Excel)",
    file: "bri-qlola.xlsx",
    // The header row is not at the top; dd-mm-yy dates; Uraian Transaksi; Debet / Kredit.
    build: () =>
      xlsxBuffer("Mutasi", [
        ["QLola by BRI"],
        ["Laporan Mutasi Rekening"],
        ["Nomor Rekening", "0000-01-000123-50-9"],
        ["Periode", "01/08/2026 - 31/08/2026"],
        [],
        ["No", "Tanggal Transaksi", "Uraian Transaksi", "Teller", "Debet", "Kredit", "Saldo"],
        ...TX.map((t, i) => [i + 1, `${p2(t.d)}-08-26`, text(t), "8888", t.amt < 0 ? abs(t.amt) : 0, t.amt > 0 ? t.amt : 0, BAL[i]]),
      ]),
  },
  // ---- BNI ----
  { bank: "BNI", format: "BNIDirect (CSV)", file: "bni-direct.csv", build: bniDirectCsv },
  { bank: "BNI", format: "BNIDirect (Excel)", file: "bni-direct.xlsx", build: bniDirectXlsx },
  {
    bank: "BNI",
    format: "BNI Mobile (Excel)",
    file: "bni-mobile.xlsx",
    build: () =>
      xlsxBuffer("Sheet1", [
        ["BNI Mobile Banking - Mutasi Rekening"],
        ["Tanggal", "Keterangan", "Tipe", "Jumlah", "Saldo"],
        ...TX.map((t, i) => [`${p2(t.d)}/08/2026`, text(t), t.amt < 0 ? "DB" : "CR", abs(t.amt), BAL[i]]),
      ]),
  },
  // ---- CIMB Niaga ----
  { bank: "CIMB", format: "OCTO / BizChannel (CSV)", file: "cimb-octo.csv", build: () => cimbOctoCsv(MON_EN[7]) },
  {
    bank: "CIMB",
    format: "OCTO (Excel)",
    file: "cimb-octo.xlsx",
    build: () =>
      xlsxBuffer("Sheet1", [
        ["PT Bank CIMB Niaga Tbk"],
        ["Nomor Rekening", "800123456789"],
        [],
        ["Tgl. Txn", "Tgl. Valuta", "Deskripsi", "No. Ref/Cek", "Debit", "Kredit", "Saldo"],
        ...TX.map((t, i) => [`${p2(t.d)}/08/2026`, `${p2(t.d)}/08/2026`, text(t), `${900 + i}`, t.amt < 0 ? en(t.amt) : "0.00", t.amt > 0 ? en(t.amt) : "0.00", en(BAL[i])]),
      ]),
  },
  // ---- Permata ----
  { bank: "PERMATA", format: "PermataNet (CSV)", file: "permata.csv", build: permataCsv },
  {
    bank: "PERMATA",
    format: "PermataNet (Excel)",
    file: "permata.xlsx",
    build: () =>
      xlsxBuffer("Sheet1", [
        ["PermataNet - Mutasi Rekening"],
        ["No. Rekening : 4100123456"],
        ["Tanggal Transaksi", "Tanggal Efektif", "Deskripsi", "Debit", "Kredit", "Saldo"],
        ...TX.map((t, i) => [`${p2(t.d)}/08/2026`, `${p2(t.d)}/08/2026`, text(t), t.amt < 0 ? abs(t.amt) : 0, t.amt > 0 ? t.amt : 0, BAL[i]]),
      ]),
  },
  // ---- Inferred layouts (no public sample): the bank's heading + a common table ----
  {
    bank: "DANAMON",
    format: "Danamon Cash Connect (CSV)",
    file: "danamon.csv",
    build: () =>
      Buffer.from(
        [
          "Danamon Cash Connect - Rekening Koran",
          "No. Rekening : 003600123456",
          "Tanggal,Keterangan,Debit,Kredit,Saldo",
          ...TX.map((t, i) => `${p2(t.d)}/08/2026,${q(text(t))},${q(t.amt < 0 ? en(t.amt) : "")},${q(t.amt > 0 ? en(t.amt) : "")},${q(en(BAL[i]))}`),
        ].join("\n"),
      ),
  },
  {
    bank: "OCBC",
    format: "OCBC Business / Velocity (CSV)",
    file: "ocbc.csv",
    build: () =>
      Buffer.from(
        [
          "OCBC Business - Account Statement",
          "Account Number,693800123456",
          "Transaction Date,Value Date,Description,Withdrawals,Deposits,Balance",
          ...TX.map((t, i) => `${p2(t.d)}/08/2026,${p2(t.d)}/08/2026,${q(text(t))},${q(t.amt < 0 ? en(t.amt) : "")},${q(t.amt > 0 ? en(t.amt) : "")},${q(en(BAL[i]))}`),
        ].join("\n"),
      ),
  },
  {
    bank: "PANIN",
    format: "Panin internet banking (Excel)",
    file: "panin.xlsx",
    build: () =>
      xlsxBuffer("Mutasi", [
        ["PaninBank Internet Banking"],
        ["No. Rekening : 1002003004"],
        ["Tgl Transaksi", "Keterangan", "Debet", "Kredit", "Saldo"],
        ["", "Saldo Awal", "", "", OPEN],
        ...TX.map((t, i) => [`${p2(t.d)}/08/2026`, text(t), t.amt < 0 ? abs(t.amt) : 0, t.amt > 0 ? t.amt : 0, BAL[i]]),
      ]),
  },
  {
    bank: "MEGA",
    format: "Mega internet banking (Excel)",
    file: "mega.xlsx",
    build: () =>
      xlsxBuffer("Sheet1", [
        ["PT Bank Mega Tbk"],
        ["Nomor Rekening : 010000123456"],
        ["Tanggal", "Uraian", "Mutasi Debet", "Mutasi Kredit", "Saldo"],
        ...TX.map((t, i) => [`${p2(t.d)}-${MON_EN[7]}-2026`, text(t), t.amt < 0 ? idn(t.amt) : "0,00", t.amt > 0 ? idn(t.amt) : "0,00", idn(BAL[i])]),
      ]),
  },
  {
    bank: "DKI",
    format: "CMS Bank DKI (CSV)",
    file: "dki.csv",
    build: () =>
      Buffer.from(
        [
          "PT Bank DKI - Cash Management System",
          "Nomor Rekening;10208001234",
          "Tanggal;Jam;Keterangan;Debet;Kredit;Saldo",
          ...TX.map((t, i) => `${p2(t.d)}/08/2026;10:15:30;${text(t)};${t.amt < 0 ? idn(t.amt) : "0,00"};${t.amt > 0 ? idn(t.amt) : "0,00"};${idn(BAL[i])}`),
        ].join("\n"),
      ),
  },
  {
    bank: "BJB",
    format: "bjb internet banking (Excel)",
    file: "bjb.xlsx",
    build: () =>
      xlsxBuffer("Sheet1", [
        ["bank bjb - Mutasi Rekening"],
        ["No. Rekening : 0012345678100"],
        ["Tanggal", "Keterangan", "Debet", "Kredit", "Saldo"],
        ...TX.map((t, i) => [`${p2(t.d)}/08/2026`, text(t), t.amt < 0 ? abs(t.amt) : 0, t.amt > 0 ? t.amt : 0, BAL[i]]),
      ]),
  },
];
