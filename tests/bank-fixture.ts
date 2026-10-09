import { expect } from "vitest";
import { checkContinuity } from "@/lib/import/normalize";
import type { ParsedStatement } from "@/lib/import/types";
import { makePdf, table, type PdfText } from "./pdf-fixture";
import { OPEN, TX, BAL, CLOSE, EXPECT_AMOUNTS, EXPECT_DATES, p2, en, idn, xlsxBuffer } from "./fixture-rows";
export { OPEN, TX, BAL, CLOSE, EXPECT_AMOUNTS, EXPECT_DATES, p2, en, idn, xlsxBuffer };

/**
 * Synthetic statements in the layouts other Indonesian banks export (BRI/BNI internet banking, Mandiri Livin', CIMB OCTO,
 * Permata …), all describing the same five August 2026 transactions of a made-up company — so every layout must read to the
 * same rows, sign and running balance. Names and account numbers are fake.
 */
type Tx = (typeof TX)[number];
const q = (s: string) => `"${s}"`;
const text = (t: Tx) => t.desc.join(" ");

export const MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Whole file read as the audit expects: five rows, right sign, dates, opening/closing, and a continuous running balance. */
export function expectAugust(st: ParsedStatement) {
  expect(st.rows.map((r) => r.amount)).toEqual(EXPECT_AMOUNTS);
  expect(st.rows.map((r) => r.date.toISOString().slice(0, 10))).toEqual(EXPECT_DATES);
  expect(st.openingBalance).toBe(BigInt(OPEN));
  expect(st.closingBalance).toBe(BigInt(CLOSE));
  expect(checkContinuity(st).ok).toBe(true);
}


// ---- CSV ----
/** BRI internet banking: "Mutasi Rekening" title, "Tanggal Transaksi" header (the words a BCA sniff looks for), dd/mm/yy, id numbers. */
export const briInternetBankingCsv = () =>
  Buffer.from(
    [
      "Laporan Mutasi Rekening",
      "No. Rekening : 0000-01-000123-50-9",
      "Nama : PT CONTOH FIKTIF",
      "",
      "Tanggal Transaksi,Uraian Transaksi,Teller,Debet,Kredit,Saldo",
      ...TX.map((t, i) => `${p2(t.d)}/08/26,${q(text(t))},0000123,${q(t.amt < 0 ? idn(t.amt) : "0,00")},${q(t.amt > 0 ? idn(t.amt) : "0,00")},${q(idn(BAL[i]))}`),
    ].join("\n"),
  );

/** BNI Direct: "Post Date" with a time, dd/mm/yy, Description, Debit/Credit. */
export const bniDirectCsv = () =>
  Buffer.from(
    [
      "BNI Direct - Mutasi Rekening",
      "Account No : 0000001234",
      "Account Name : PT CONTOH FIKTIF",
      "Period : 01/08/2026 - 31/08/2026",
      "",
      "Post Date,Branch,Journal No,Description,Debit,Credit,Balance",
      ...TX.map((t, i) => `${p2(t.d)}/08/26 10:15:30,0998,${7000 + i},${q(text(t))},${t.amt < 0 ? q(en(t.amt)) : "0.00"},${t.amt > 0 ? q(en(t.amt)) : "0.00"},${q(en(BAL[i]))}`),
    ].join("\n"),
  );

/** Permata: two date columns, "Transaction Desc". */
export const permataCsv = () =>
  Buffer.from(
    [
      "PermataNet - Account Statement",
      "Account No : 4100123456",
      "Posting Date,Eff Date,Transaction Desc,Debit,Credit,Balance",
      ...TX.map((t, i) => `${p2(t.d)}/08/2026,${p2(t.d)}/08/2026,${q(text(t))},${t.amt < 0 ? Math.abs(t.amt) + ".00" : "0.00"},${t.amt > 0 ? t.amt + ".00" : "0.00"},${BAL[i]}.00`),
    ].join("\n"),
  );

/** CIMB OCTO: title rows without ';', then a ';' table with dd-Mmm-yyyy dates. */
export const cimbOctoCsv = (month = MON_EN[7]) =>
  Buffer.from(
    [
      "CIMB Niaga - Rekening Koran",
      "Nomor Rekening;800123456789",
      "Tanggal;Deskripsi;Debit;Kredit;Saldo",
      ...TX.map((t, i) => `${p2(t.d)}-${month}-2026;${text(t)};${t.amt < 0 ? Math.abs(t.amt) : 0};${t.amt > 0 ? t.amt : 0};${BAL[i]}`),
    ].join("\n"),
  );

/** A statement whose title row has commas but the table is `;`-separated (comma-decimals inside). */
export const titleWithCommasSemicolonCsv = () =>
  Buffer.from(
    [
      "Rekening Koran, PT Contoh Fiktif, Agustus 2026",
      "Tanggal;Keterangan;Debet;Kredit;Saldo",
      ...TX.map((t, i) => `${p2(t.d)}/08/2026;${text(t)};${t.amt < 0 ? idn(t.amt) : "0,00"};${t.amt > 0 ? idn(t.amt) : "0,00"};${idn(BAL[i])}`),
    ].join("\n"),
  );

/** Excel "Unicode text": UTF-16 LE with a BOM, tab-separated. */
export const utf16TabCsv = () =>
  Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(
      [
        "Tanggal\tKeterangan\tDebet\tKredit\tSaldo",
        ...TX.map((t, i) => `${p2(t.d)}/08/2026\t${text(t)}\t${t.amt < 0 ? Math.abs(t.amt) : 0}\t${t.amt > 0 ? t.amt : 0}\t${BAL[i]}`),
      ].join("\n"),
      "utf16le",
    ),
  ]);

// ---- XLSX ----
/** BNI (Direct export): dd-Mmm-yy English months, one Jumlah column with a D/K column. */
export const bniDirectXlsx = () =>
  xlsxBuffer("Sheet1", [
    ["Laporan Mutasi Rekening BNI"],
    ["No. Rekening : 0000001234"],
    [],
    ["Tanggal Transaksi", "Keterangan", "Jumlah", "D/K", "Saldo"],
    ["01-Aug-26", "SALDO AWAL", "", "", OPEN],
    ...TX.map((t, i) => [`${p2(t.d)}-Aug-26`, text(t), Math.abs(t.amt), t.amt < 0 ? "D" : "K", BAL[i]]),
  ]);

/** BNI Mobile: a "Tipe" column of DB/CR beside an unsigned "Jumlah". */
export const bniMobileXlsx = () =>
  xlsxBuffer("Sheet1", [
    ["Tanggal", "Keterangan", "Tipe", "Jumlah", "Saldo"],
    ...TX.map((t, i) => [`${p2(t.d)}/08/2026`, text(t), t.amt < 0 ? "DB" : "CR", Math.abs(t.amt), BAL[i]]),
  ]);

/** Mandiri Livin': Indonesian month names, one signed Nominal ("+55.500.000,00" / "-2.450.000,00"). */
export const mandiriLivinXlsx = () =>
  xlsxBuffer("Sheet1", [
    ["Bank Mandiri - Livin' by Mandiri"],
    ["Rekening: 0000000123456 a.n. PT CONTOH FIKTIF"],
    ["Periode: 01 Agu 2026 - 31 Agu 2026"],
    [],
    ["Tanggal", "Keterangan", "Nominal", "Saldo"],
    ["01 Agu 2026", "SALDO AWAL", "", idn(OPEN)],
    ...TX.map((t, i) => [`${p2(t.d)} Agu 2026`, text(t), (t.amt > 0 ? "+" : "-") + idn(t.amt), idn(BAL[i])]),
  ]);

/** Date cells formatted General: the cell holds the Excel serial (46235 = 2026-08-02). */
export const serialDateXlsx = () =>
  xlsxBuffer("S", [
    ["Tanggal", "Keterangan", "Debet", "Kredit", "Saldo"],
    ["SALDO AWAL", "", "", "", 1000],
    [46235, "A", 0, 100, 1100],
    [46236, "B", 50, 0, 1050],
  ]);

// ---- PDF ----
const PDF_HEAD = (lines: string[]): PdfText[] => table(800, lines.map((l) => [[40, l]] as [number, string][]));

/** CIMB e-statement: dd-Mmm-yyyy (or "dd Mmm yyyy") dates, Debit / Kredit columns. */
export function cimbPdf(date: (d: number) => string = (d) => `${p2(d)}-Aug-2026`, labels = ["Tanggal", "Deskripsi", "Debit", "Kredit", "Saldo"]) {
  const head: [number, string][] = [[40, labels[0]], [110, labels[1]], [360, labels[2]], [440, labels[3]], [520, labels[4]]];
  return makePdf([
    [
      ...PDF_HEAD(["PT Bank CIMB Niaga Tbk", "Nomor Rekening : 800123456789", "Periode : 01/08/2026 - 31/08/2026"]),
      ...table(740, [head, ...TX.map((t, i) => [[40, date(t.d)], [110, t.desc[0]], [t.amt < 0 ? 355 : 435, idn(t.amt)], [505, idn(BAL[i])]] as [number, string][])]),
    ],
  ]);
}

/** Mandiri Livin' PDF: one Nominal column, "+1.000.000" / "-1.000.000". */
export function mandiriLivinPdf(sign: (amt: number) => string = (a) => (a > 0 ? "+" : "-") + idn(a)) {
  const head: [number, string][] = [[40, "Tanggal"], [110, "Keterangan"], [400, "Nominal"], [490, "Saldo"]];
  return makePdf([
    [
      ...PDF_HEAD(["Bank Mandiri Livin", "Nomor Rekening : 0000000123456", "Periode : 01/08/2026 - 31/08/2026"]),
      ...table(740, [head, [[40, "01/08/2026"], [110, "SALDO AWAL"], [490, idn(OPEN)]], ...TX.map((t, i) => [[40, `${p2(t.d)}/08/2026`], [110, t.desc[0]], [400, sign(t.amt)], [490, idn(BAL[i])]] as [number, string][])]),
    ],
  ]);
}
