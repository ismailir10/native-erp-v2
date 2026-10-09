import type { BankCode } from "@/lib/generated/prisma/enums";
import { BAL, CLOSE, OPEN, TX, en, p2 } from "./bank-fixture";

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
];
