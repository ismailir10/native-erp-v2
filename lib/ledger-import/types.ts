import type { AccountType } from "@/lib/generated/prisma/enums";

/** A raw spreadsheet cell: text, number, date, or an Excel error such as "#VALUE!" (kept verbatim for checks). */
export type RawCell = string | number | Date | { error: string } | null;
export type RawSheet = { name: string; rows: RawCell[][] };

export type LedgerMode = "LEDGER" | "NERACA";

export type ColumnKey = "date" | "code" | "name" | "debit" | "credit" | "amount" | "desc" | "voucher" | "entity" | "currency" | "rate" | "notes";
export type Columns = Partial<Record<ColumnKey, number>>;

export type TableCandidate = { sheet: string; headerRow: number; mode: LedgerMode; columns: Columns; dataRows: number };

/** One ledger line as read from the file. Amounts are signed sen (debit − credit side kept separately). */
export type LedgerRow = {
  /** "sheet!row" (1-based Excel row). */
  ref: string;
  row: number;
  date: Date | null;
  entity: string | null;
  code: string;
  name: string;
  debit: bigint;
  credit: bigint;
  currency: string | null;
  rate: string | null;
  description: string;
  voucher: string | null;
  /** Problems reading this row (non-numeric amount, missing date/account…) — become BLOCK checks. */
  errors: string[];
};

export type NeracaRow = {
  ref: string;
  row: number;
  code: string;
  name: string;
  /** Signed sen, debit-positive (assets +, liabilities/equity −, contra accounts flipped by their sign). */
  amount: bigint;
  typeHint: AccountType | null;
  coded: boolean;
  errors: string[];
};

export type NeracaTotal = { ref: string; label: string; amount: bigint; kind: "ASSETS" | "LIAB_EQUITY" | "OTHER" };

export type ReadResult =
  | { mode: "LEDGER"; sheet: string; rows: LedgerRow[] }
  | { mode: "NERACA"; sheet: string; date: Date | null; rows: NeracaRow[]; totals: NeracaTotal[] };
