import type { BankCode } from "@/lib/generated/prisma/enums";

export type ParsedRow = {
  date: Date;
  description: string;
  /** Signed integer Rupiah: + in, − out. */
  amount: bigint;
  balance: bigint | null;
  rowNumber: number;
  rawRow: string;
};

export type ParsedStatement = {
  format: BankCode;
  accountNumber: string | null;
  periodStart: Date;
  periodEnd: Date;
  openingBalance: bigint;
  closingBalance: bigint;
  rows: ParsedRow[];
};

export class ParseError extends Error {}
