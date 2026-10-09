import { parseRupiah } from "@/lib/money";
import { dateOnly } from "@/lib/format";
import { ParseError, type ParsedRow, type ParsedStatement } from "@/lib/import/types";
import { closingFromRows, monthBoundsOf, parseDateDMY, periodFromText, readCsv, SenWatch, splitMarker } from "@/lib/import/parsers/common";

/**
 * KlikBCA CSV mutasi exports. Two exports, two layouts:
 * - **KlikBCA Bisnis**: an "Informasi Rekening - Mutasi Rekening" title, `No. rekening` / `Periode` lines, the header
 *   `Tanggal Transaksi, Keterangan, Cabang, Jumlah, [DB/CR,] Saldo`, a summary after the rows (`Saldo Awal`, `Mutasi Debet`, `Mutasi
 *   Kredit`, `Saldo Akhir`). Older files write year-less `'DD/MM` dates and a separate DB/CR column; current ones full `dd/mm/yyyy` dates
 *   and the direction in the amount cell (`"3,528,964.00 CR"`). `PEND` rows (pending) carry the last date.
 * - **KlikBCA Individual**: `Account No.,=,'0123…` metadata, the header `Date, Description, Branch, Amount, , Balance` (the unlabeled
 *   column holds CR/DB), `'dd/mm/yyyy` dates, unquoted descriptions that may contain commas, a `Starting Balance,=,…` trailer.
 */
export function isBcaCsv(text: string) {
  // BRI / BNI / BSI internet banking use the same title words and a "Tanggal Transaksi" column: only KlikBCA's header row
  // (Tanggal Transaksi, Keterangan, Cabang, Jumlah …) makes it BCA.
  return /Informasi Rekening|Mutasi Rekening/i.test(text.slice(0, 300)) && /^"?Tanggal Transaksi"?\s*,\s*"?Keterangan"?\s*,\s*"?Cabang\b/im.test(text);
}

export function isBcaIndividualCsv(text: string) {
  return /^"?Account No\.?"?\s*,\s*"?="?/im.test(text.slice(0, 400)) && /^"?Date"?\s*,\s*"?Description"?\s*,\s*"?Branch"?\s*,\s*"?Amount"?/im.test(text);
}

/** "DB" (money out), "CR" (money in) or null from a DB/CR cell. */
const flagOf = (cell: string | undefined) => (/^\s*(DB|DR|D)\.?\s*$/i.test(cell ?? "") ? "DB" : /^\s*(CR|K|C)\.?\s*$/i.test(cell ?? "") ? "CR" : null);

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
    if (headerIdx < 0 && /^Tanggal Transaksi/i.test(r[0])) headerIdx = i;
    const total = line.match(/:\s*,?\s*"?(-?[\d.,]+\d)/)?.[1];
    if (/^Saldo Awal/i.test(r[0]) && total) opening = parseRupiah(total);
    if (/^Saldo Akhir/i.test(r[0]) && total) closing = parseRupiah(total);
  });
  if (headerIdx < 0) throw new ParseError("Header 'Tanggal Transaksi' BCA tidak ditemukan");
  if (!period) throw new ParseError("Baris 'Periode' BCA tidak ditemukan");
  const { start, end } = period as { start: Date; end: Date };
  const header = rows[headerIdx].map((h) => h.trim());
  const cAmt = header.findIndex((h) => /^jumlah$/i.test(h));
  const cBal = header.findIndex((h) => /^saldo$/i.test(h));
  if (cAmt < 0 || cBal < 0) throw new ParseError("Kolom 'Jumlah' / 'Saldo' BCA tidak ditemukan");
  // The older export puts DB/CR in an unlabeled column right after Jumlah.
  const cFlag = cAmt + 1 < cBal && !header[cAmt + 1] ? cAmt + 1 : -1;

  const sen = new SenWatch();
  const parsed: ParsedRow[] = [];
  let lastDate = start;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] || /^Saldo|^Mutasi/i.test(r[0])) continue;
    const rawDate = r[0];
    let date = lastDate;
    if (!/PEND/i.test(rawDate)) {
      const t = rawDate.replace(/^'/, "").trim();
      const m = t.match(/^(\d{1,2})\/(\d{1,2})$/);
      if (m) {
        const month = Number(m[2]);
        // Year-less date: take the period year; a December row in a Jan-start period belongs to the prior year.
        const year = month < start.getUTCMonth() + 1 ? end.getUTCFullYear() : start.getUTCFullYear();
        date = dateOnly(year, month, Number(m[1]));
      } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) {
        date = parseDateDMY(t);
      } else throw new ParseError(`Tanggal BCA tidak valid di baris ${i + 1}: "${rawDate}"`);
    }
    lastDate = date;
    const amountCell = splitMarker(r[cAmt] ?? "");
    const flag = amountCell.flag ?? flagOf(cFlag >= 0 ? r[cFlag] : undefined);
    sen.check(r[cAmt], i + 1);
    sen.check(r[cBal], i + 1);
    const amount = parseRupiah(amountCell.text);
    parsed.push({
      date,
      description: (r[1] ?? "").replace(/\s+/g, " ").trim(),
      amount: flag === "DB" ? -amount : amount,
      balance: r[cBal] ? parseRupiah(r[cBal]) : null,
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
    ...(sen.note() ? { notes: [sen.note()!] } : {}),
  };
}

export function parseBcaIndividual(text: string): ParsedStatement {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  // The description isn't quoted and may hold commas: a row is split on commas and read from both ends.
  const cells = (line: string) => line.split(",").map((c) => c.trim().replace(/^"(.*)"$/, "$1"));
  const meta = (label: RegExp) => {
    const l = lines.find((x) => label.test(x));
    return l ? cells(l).slice(2).join(",").replace(/^'/, "").trim() : null;
  };
  const headerIdx = lines.findIndex((l) => /^"?Date"?\s*,\s*"?Description"?/i.test(l));
  if (headerIdx < 0) throw new ParseError("Header 'Date, Description' KlikBCA tidak ditemukan");
  const amountOf = (t: string | null) => (t && /\d/.test(t) ? parseRupiah(t) : null);
  const opening = amountOf(meta(/^"?Starting Balance"?\s*,/i));
  const closing = amountOf(meta(/^"?Ending Balance"?\s*,/i));
  const sen = new SenWatch();
  const parsed: ParsedRow[] = [];
  let lastDate: Date | null = null;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^"?(Starting Balance|Ending Balance|Credit|Debet|Debit)"?\s*,\s*"?="?/i.test(line)) continue;
    const c = cells(line);
    if (c.length < 6) throw new ParseError(`Baris KlikBCA ${i + 1} tidak lengkap: "${line.slice(0, 60)}"`);
    const [balance, flagCell, amount] = [c[c.length - 1], c[c.length - 2], c[c.length - 3]];
    const rawDate = c[0].replace(/^'/, "");
    const date: Date = /PEND/i.test(rawDate) && lastDate ? lastDate : parseDateDMY(rawDate);
    lastDate = date;
    const flag = flagOf(flagCell);
    sen.check(amount, i + 1);
    sen.check(balance, i + 1);
    const value = parseRupiah(amount);
    parsed.push({
      date,
      description: c.slice(1, c.length - 4).join(",").replace(/\s+/g, " ").trim(),
      amount: flag === "DB" ? -value : value,
      balance: balance ? parseRupiah(balance) : null,
      rowNumber: i + 1,
      rawRow: line,
    });
  }
  const { start, end } = monthBoundsOf(parsed);
  const openingBalance = opening ?? (parsed[0]?.balance != null ? parsed[0].balance - parsed[0].amount : null);
  if (openingBalance === null) throw new ParseError("Saldo awal tidak dapat ditentukan (tidak ada Starting Balance dan kolom saldo kosong)");
  return {
    format: "BCA",
    accountNumber: meta(/^"?Account No\.?"?\s*,/i)?.replace(/\D/g, "") || null,
    periodStart: start,
    periodEnd: end,
    openingBalance,
    closingBalance: closing ?? closingFromRows(parsed, openingBalance),
    rows: parsed,
    ...(sen.note() ? { notes: [sen.note()!] } : {}),
  };
}
