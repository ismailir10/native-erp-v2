import type { BankCode } from "@/lib/generated/prisma/enums";

export type ParsedRow = {
  date: Date;
  description: string;
  /** Signed integer Rupiah: + in, − out. */
  amount: bigint;
  balance: bigint | null;
  rowNumber: number;
  rawRow: string;
  /** Workbook sources: the sheet the row is on (row numbers count within it). */
  sheet?: string;
};

export type ParsedStatement = {
  format: BankCode;
  accountNumber: string | null;
  periodStart: Date;
  periodEnd: Date;
  openingBalance: bigint;
  closingBalance: bigint;
  rows: ParsedRow[];
  /** Combined statements (one PDF, several accounts): the section's account name and currency as printed. */
  section?: { label: string; currency: string };
  /** Choices the parser made that the accountant should know (direction read from the balance, sheets joined). */
  notes?: string[];
  /** Workbook sources: the sheets read into this statement, in date order. */
  sheets?: string[];
};

export class ParseError extends Error {}

/** Dates without a year and none in the file's content: the accountant supplies it (prefilled with `guess` from the file name). */
export class YearNeededError extends ParseError {
  constructor(readonly guess: number | null) {
    super("File ini tidak mencantumkan tahun (tanggal hanya hari/bulan). Isi tahun bulan pertamanya.");
  }
}
