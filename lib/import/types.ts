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
  /** Combined statements (one PDF, several accounts): the section's account name and currency as printed. */
  section?: { label: string; currency: string };
};

export class ParseError extends Error {}
