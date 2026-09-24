import Papa from "papaparse";
import { dateOnly } from "@/lib/format";
import { ParseError, type ParsedRow } from "@/lib/import/types";

export function readCsv(text: string, delimiter?: string): string[][] {
  const res = Papa.parse<string[]>(text.replace(/^﻿/, ""), { delimiter, skipEmptyLines: false });
  return res.data.map((r) => r.map((c) => (c ?? "").trim()));
}

/** "31/08/2026", "2026-08-31", "31-08-2026" → UTC date-only. */
export function parseDateDMY(s: string): Date {
  const t = s.replace(/^'/, "").trim();
  let m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return dateOnly(Number(m[3]), Number(m[2]), Number(m[1]));
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return dateOnly(Number(m[1]), Number(m[2]), Number(m[3]));
  throw new ParseError(`Format tanggal tidak dikenali: "${s}"`);
}

export function periodFromText(s: string): { start: Date; end: Date } | null {
  const m = s.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*[-–s.d]+\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
  if (!m) return null;
  return { start: parseDateDMY(m[1]), end: parseDateDMY(m[2]) };
}

export function monthBoundsOf(rows: ParsedRow[]) {
  if (rows.length === 0) throw new ParseError("File tidak berisi transaksi");
  const first = rows[0].date;
  const last = rows[rows.length - 1].date;
  return {
    start: dateOnly(first.getUTCFullYear(), first.getUTCMonth() + 1, 1),
    end: new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 0)),
  };
}

export function openingFromRows(rows: ParsedRow[]): bigint {
  const first = rows[0];
  if (!first || first.balance === null) throw new ParseError("Saldo awal tidak dapat ditentukan (kolom saldo kosong)");
  return first.balance - first.amount;
}

export function closingFromRows(rows: ParsedRow[], opening: bigint): bigint {
  const withBalance = [...rows].reverse().find((r) => r.balance !== null);
  return withBalance?.balance ?? opening + rows.reduce((s, r) => s + r.amount, 0n);
}
