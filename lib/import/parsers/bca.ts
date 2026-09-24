import { parseRupiah } from "@/lib/money";
import { dateOnly } from "@/lib/format";
import { ParseError, type ParsedRow, type ParsedStatement } from "@/lib/import/types";
import { closingFromRows, periodFromText, readCsv } from "@/lib/import/parsers/common";

/**
 * KlikBCA (Bisnis) CSV mutasi export — approximated from 2026 exports; validate with real files.
 * Quirks: year-less "'DD/MM" dates (year from "Periode"), "PEND" rows, amount + "DB"/"CR" column,
 * totals trailer ("Saldo Awal", "Saldo Akhir").
 */
export function isBcaCsv(text: string) {
  return /Informasi Rekening|Mutasi Rekening/i.test(text.slice(0, 300)) && /Tanggal Transaksi/i.test(text);
}

export function parseBca(text: string): ParsedStatement {
  const rows = readCsv(text);
  let accountNumber: string | null = null;
  let period: { start: Date; end: Date } | null = null;
  let opening: bigint | null = null;
  let closing: bigint | null = null;
  let headerIdx = -1;

  rows.forEach((r, i) => {
    const line = r.join(",");
    if (/^No\.? ?rekening/i.test(r[0])) accountNumber = line.split(":")[1]?.replace(/[^\d]/g, "") || null;
    if (/^Periode/i.test(r[0])) period = periodFromText(line);
    if (/^Tanggal Transaksi/i.test(r[0])) headerIdx = i;
    const total = line.match(/:\s*,?\s*"?([\d.,]+\d)/)?.[1];
    if (/^Saldo Awal/i.test(r[0]) && total) opening = parseRupiah(total);
    if (/^Saldo Akhir/i.test(r[0]) && total) closing = parseRupiah(total);
  });
  if (headerIdx < 0) throw new ParseError("Header 'Tanggal Transaksi' BCA tidak ditemukan");
  if (!period) throw new ParseError("Baris 'Periode' BCA tidak ditemukan");
  const { start, end } = period as { start: Date; end: Date };

  const parsed: ParsedRow[] = [];
  let lastDate = start;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] || /^Saldo|^Mutasi/i.test(r[0])) continue;
    const [rawDate, desc, , amountStr, dbcr, balanceStr] = r;
    let date = lastDate;
    if (!/PEND/i.test(rawDate)) {
      const m = rawDate.replace(/^'/, "").match(/^(\d{1,2})\/(\d{1,2})$/);
      if (!m) throw new ParseError(`Tanggal BCA tidak valid di baris ${i + 1}: "${rawDate}"`);
      const month = Number(m[2]);
      // Year-less date: take the period year; a December row in a Jan-start period belongs to the prior year.
      const year = month < start.getUTCMonth() + 1 ? end.getUTCFullYear() : start.getUTCFullYear();
      date = dateOnly(year, month, Number(m[1]));
    }
    lastDate = date;
    const amount = parseRupiah(amountStr);
    const signed = /DB/i.test(dbcr) ? -amount : amount;
    parsed.push({
      date,
      description: desc.replace(/\s+/g, " ").trim(),
      amount: signed,
      balance: balanceStr ? parseRupiah(balanceStr) : null,
      rowNumber: i + 1,
      rawRow: r.join(","),
    });
  }
  const openingBalance = opening ?? (parsed[0]?.balance != null ? parsed[0].balance - parsed[0].amount : 0n);
  return {
    format: "BCA",
    accountNumber,
    periodStart: start,
    periodEnd: end,
    openingBalance,
    closingBalance: closing ?? closingFromRows(parsed, openingBalance),
    rows: parsed,
  };
}
