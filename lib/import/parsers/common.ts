import Papa from "papaparse";
import { dateOnly } from "@/lib/format";
import { parseCents, parseRupiah } from "@/lib/money";
import { ParseError, SourceAmountError, SourceCurrencyError, SourceDateError, type ParsedRow } from "@/lib/import/types";

export function readCsv(text: string, delimiter?: string): string[][] {
  const res = Papa.parse<string[]>(text.replace(/^﻿/, ""), { delimiter, skipEmptyLines: false });
  return res.data.map((r) => r.map((c) => (c ?? "").trim()));
}

/** Text of a CSV/TXT upload: UTF-8 (BOM dropped), or UTF-16 with a BOM (Excel's "Unicode text"). */
export function decodeText(data: Buffer): string {
  if (data[0] === 0xff && data[1] === 0xfe) return data.subarray(2).toString("utf16le");
  if (data[0] === 0xfe && data[1] === 0xff) return Buffer.from(data.subarray(2)).swap16().toString("utf16le");
  return data.toString("utf8").replace(/^\uFEFF/, "");
}

/**
 * The delimiter of a text table: whichever of tab, ';' and ',' splits most of the first lines into the same number of fields
 * (title rows above the table, or a decimal comma inside a cell, must not decide it). Delimiters inside quotes don't count.
 */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 12);
  let best = ",";
  let bestScore = 0;
  for (const d of ["\t", ";", ","]) {
    const counts = lines.map((l) => {
      let n = 0;
      let quoted = false;
      for (const ch of l) {
        if (ch === '"') quoted = !quoted;
        else if (ch === d && !quoted) n++;
      }
      return n;
    });
    const tally = new Map<number, number>();
    for (const c of counts) if (c > 0) tally.set(c, (tally.get(c) ?? 0) + 1);
    // Score: fields on the lines that agree on the most common count (ties: the wider table).
    const [mode, lineCount] = [...tally.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? [0, 0];
    const score = mode * lineCount;
    if (score > bestScore) [best, bestScore] = [d, score];
  }
  return best;
}

/** Month names as Indonesian and English statements print them, full or abbreviated (lower case). */
export const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, pebruari: 2, februari: 2, february: 2, mar: 3, maret: 3, march: 3, apr: 4, april: 4,
  mei: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, agu: 8, agt: 8, agus: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, nop: 11, nopember: 11, november: 11,
  des: 12, desember: 12, dec: 12, december: 12,
};

export type DateParts = { d: number; m: number; y: number | null };

/** Time of day after a date ("10:15:30", "10.15", "2:05 PM", "00:00:00.000Z", "10:15+07:00"): part of the cell, not of the date. */
const TIME = String.raw`(?:[ T]+\d{1,2}[:.]\d{2}(?:[:.]\d{2}(?:\.\d+)?)?(?:\s*[AaPp][Mm])?(?:\s*(?:Z|[+-]\d{2}:?\d{2}))?)?`;
const year = (y: string) => Number(y.length === 2 ? `20${y}` : y);

/** Day before month (Indonesian, the default) or month before day (US exports) — decided per file, never per row. */
export type DayMonthOrder = "DMY" | "MDY";

/** A date written as two numbers and an optional year ("13/02/2026", "02-13-26", "'31/08"), with an optional time. */
const NUMERIC_DATE = new RegExp(String.raw`^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?${TIME}$`);

/**
 * How a file writes its numeric dates (QA E17: a US file must never be read day-first in silence). `dmy` is the first text whose first
 * number can only be a day (> 12), `mdy` the first whose second number can only be one; both null when every numeric date fits either
 * order (or there is none). Callers decide: one example → that order; both → the file mixes formats; none → `chronologicalOrder`.
 */
export function dayMonthEvidence(texts: string[]): { dmy: string | null; mdy: string | null; numeric: string[] } {
  let dmy: string | null = null;
  let mdy: string | null = null;
  const numeric: string[] = [];
  for (const raw of texts) {
    const t = raw.replace(/^'/, "").trim();
    const m = t.match(NUMERIC_DATE);
    if (!m) continue;
    numeric.push(t);
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a > 12 && b >= 1 && b <= 12 && a <= 31) dmy ??= t;
    if (b > 12 && a >= 1 && a <= 12 && b <= 31) mdy ??= t;
  }
  return { dmy, mdy, numeric };
}

/**
 * For numeric dates that fit both orders (every number ≤ 12): the order in which they run in time, oldest or newest first (a statement
 * is a time series). Day/month wins a tie; null when neither order runs in time.
 */
export function chronologicalOrder(texts: string[]): DayMonthOrder | null {
  const runs = (order: DayMonthOrder) => {
    const keys = texts.map((t) => dateParts(t, { order })).filter((p): p is DateParts => !!p).map((p) => (p.y ?? 0) * 10_000 + p.m * 100 + p.d);
    return keys.every((k, i) => i === 0 || k >= keys[i - 1]) || keys.every((k, i) => i === 0 || k <= keys[i - 1]);
  };
  return runs("DMY") ? "DMY" : runs("MDY") ? "MDY" : null;
}

/**
 * The day, month and (when printed) year of a statement date: "31/08/2026", "31-08-26", "2026-08-31", "'31/08" (BCA, no year),
 * "01-Aug-26", "01 Agu 2026", "3 Mei 2026", "Aug 01, 2026" — with an optional time after it. Two-digit years are 20yy.
 * `serial` also accepts an Excel serial number (a date cell formatted General). `order: "MDY"` reads two-number dates month first
 * (a US export, decided for the whole file). Null when it isn't a date.
 */
export function dateParts(text: string, opts: { serial?: boolean; order?: DayMonthOrder } = {}): DateParts | null {
  const t = text.replace(/^'/, "").trim();
  let m = t.match(new RegExp(String.raw`^(\d{4})-(\d{1,2})-(\d{1,2})${TIME}$`));
  if (m) return valid({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) });
  m = t.match(NUMERIC_DATE);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return valid({ d: opts.order === "MDY" ? b : a, m: opts.order === "MDY" ? a : b, y: m[3] ? year(m[3]) : null });
  }
  m = t.match(new RegExp(String.raw`^(\d{1,2})[\s/.-]+([A-Za-z]{3,9})\.?(?:[\s/.,-]+(\d{2}|\d{4}))?${TIME}$`));
  if (m && MONTHS[m[2].toLowerCase()]) return valid({ d: Number(m[1]), m: MONTHS[m[2].toLowerCase()], y: m[3] ? year(m[3]) : null });
  m = t.match(new RegExp(String.raw`^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})${TIME}$`));
  if (m && MONTHS[m[1].toLowerCase()]) return valid({ d: Number(m[2]), m: MONTHS[m[1].toLowerCase()], y: Number(m[3]) });
  if (opts.serial && /^\d{5}(?:\.\d+)?$/.test(t)) {
    const date = excelSerialDate(Number(t));
    if (date) return { d: date.getUTCDate(), m: date.getUTCMonth() + 1, y: date.getUTCFullYear() };
  }
  return null;
}

function valid(p: DateParts): DateParts | null {
  return p.m >= 1 && p.m <= 12 && p.d >= 1 && p.d <= 31 ? p : null;
}

/** An Excel serial day number (1900 system) as a UTC date; null outside 1982–2064, where a bare number is no date. */
export function excelSerialDate(serial: number): Date | null {
  if (!(serial >= 30000 && serial < 60000)) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
}

/** "31/08/2026", "2026-08-31", "31-08-2026", "31-Aug-26" → UTC date-only. */
export function parseDateDMY(s: string): Date {
  const p = dateParts(s);
  if (!p || p.y === null) throw new ParseError(`Format tanggal tidak dikenali: "${s}"`);
  return calendarDate(p.y, p.m, p.d);
}

export function periodFromText(s: string): { start: Date; end: Date } | null {
  const m = s.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*[-–s.d]+\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
  if (!m) return null;
  return { start: parseDateDMY(m[1]), end: parseDateDMY(m[2]) };
}

export function monthBoundsOf(rows: ParsedRow[]) {
  if (rows.length === 0) throw new ParseError("File tidak berisi transaksi");
  const first = rows.reduce((earliest, row) => +row.date < +earliest ? row.date : earliest, rows[0].date);
  const last = rows.reduce((latest, row) => +row.date > +latest ? row.date : latest, rows[0].date);
  return {
    start: dateOnly(first.getUTCFullYear(), first.getUTCMonth() + 1, 1),
    end: new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 0)),
  };
}

/** Opening = the first printed balance less the movement up to and including that row; null when no row prints a balance. */
export function openingFromRows(rows: ParsedRow[]): bigint {
  const opening = openingFromBalances(rows);
  if (opening === null) throw new ParseError("Saldo awal tidak dapat ditentukan (kolom saldo kosong)");
  return opening;
}

export function openingFromBalances(rows: ParsedRow[]): bigint | null {
  let moved = 0n;
  for (const r of rows) {
    moved += r.amount;
    if (r.balance !== null) return r.balance - moved;
  }
  return null;
}

/** A direction printed after an amount: "1,000.00 CR", "5.500,00 D", "250.000 Db.", "1.000,00 K". */
const MARKER = /\s*\(?(?<![A-Za-z])(CR|DB|DR|D|K|C)\.?\)?\s*$/i;

/**
 * An amount cell that may carry its direction (KlikBCA Bisnis "3,528,964.00 CR", Mandiri savings "5,500.00 D", a trailing minus
 * "1.000.000-"): the unsigned text to parse, and the direction it states — "DB" money out, "CR" money in, null when it states none.
 * Text without a digit is returned as is (no marker taken from a word).
 */
export function splitMarker(text: string): { text: string; flag: "DB" | "CR" | null } {
  const t = text.trim();
  if (!/\d/.test(t)) return { text: t, flag: null };
  const m = t.match(MARKER);
  if (m && /\d/.test(t.slice(0, m.index))) {
    const f = m[1].toUpperCase();
    return { text: t.slice(0, m.index).trim(), flag: f === "DB" || f === "DR" || f === "D" ? "DB" : "CR" };
  }
  if (/^[\d.,\s]+-$/.test(t)) return { text: t.slice(0, -1).trim(), flag: "DB" };
  return { text: t, flag: null };
}

/**
 * Amounts are whole Rupiah (accounting-rules §6a: sen round half-up per line), but a statement that prints sen must say so: the
 * running balance can then differ by a few Rupiah from the file's. Collects every value with a non-zero fraction.
 */
export class SenWatch {
  private hits: { row: number; text: string }[] = [];
  check(text: string | undefined, row: number) {
    if (!text) return;
    try {
      if (parseCents(splitMarker(text).text) % 100n !== 0n && !this.hits.some((h) => h.row === row && h.text === text.trim())) this.hits.push({ row, text: text.trim() });
    } catch {
      // not a number: the amount reader reports it
    }
  }
  /** One note for the statement (Bahasa), or null when every amount was whole. */
  note(): string | null {
    if (!this.hits.length) return null;
    const eg = this.hits.slice(0, 3).map((h) => `baris ${h.row}: "${h.text}"`).join(", ");
    return `${this.hits.length} nilai berisi sen (mis. ${eg}). Buku membulatkan setiap nilai ke Rupiah penuh, jadi saldo berjalan bisa selisih beberapa Rupiah dari file.`;
  }
}

/** Closing at the final row, including movements after the last printed checkpoint. */
export function closingFromRows(rows: ParsedRow[], opening: bigint): bigint {
  return rows.reduce((running, row) => row.balance ?? running + row.amount, opening);
}

/** Only a balance printed on the final row independently states the closing. */
export function closingProvenance(rows: ParsedRow[]): "ROW" | "DERIVED" {
  return rows.at(-1)?.balance != null ? "ROW" : "DERIVED";
}

/** Calendar construction must never let JavaScript roll a nonexistent date into another month. */
export function calendarDate(y: number, m: number, d: number): Date {
  const date = dateOnly(y, m, d);
  if (date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== m || date.getUTCDate() !== d) {
    throw new SourceDateError(`Tanggal tidak ada di kalender: ${d}/${m}/${y}`);
  }
  return date;
}

export const CURRENCY_HEADER = /^(?:currency|ccy|mata\s*uang|valuta)(?:\s*\/\s*(?:currency|ccy|mata\s*uang|valuta))?$/i;

/** Read explicit currency declarations, never incidental customer names or transaction descriptions. */
export function sourceCurrency(preamble: string[], headers: string[], amounts: string[] = [], rows: string[][] = []): string | undefined {
  const found = new Set<string>();
  const add = (unit: string) => found.add(/^(?:rp\.?|rupiah)$/i.test(unit) ? "IDR" : unit.toUpperCase());
  const unit = String.raw`(?:[A-Z]{3}|Rp\.?|Rupiah)`;
  for (const line of preamble) {
    for (const match of line.matchAll(new RegExp(String.raw`(?:^|\b)(?:mata\s*uang|currency|ccy|valuta)(?:\s*[/\-]\s*(?:currency|mata\s*uang))?\s*[:=,;\s]+(${unit})(?=$|[^A-Za-z])`, "gi"))) add(match[1]);
    const accountUnit = /\b(?:account|rekening)\b.*\(([A-Z]{3})\)/i.exec(line);
    if (accountUnit) add(accountUnit[1]);
    // Unbracketed account declarations need an adjacent account number: a customer's name is not a unit.
    const accountCode = /\b(?:account|rekening)\s*(?:no\.?|number|nomor)?\s*[:#-]?\s*([A-Z]{3})\s+\d[\d-]{5,}\b/i.exec(line);
    if (accountCode) add(accountCode[1]);
    if (/^\s*(?:IDR|USD|SGD|EUR|GBP|AUD|JPY|CNY|HKD|MYR|Rp\.?|Rupiah)\s*$/i.test(line)) add(line.trim());
  }
  for (const label of headers) {
    if (!/^(?:debit|debet|credit|kredit|amount|jumlah|nominal|mutasi|saldo|balance|withdrawal|deposit)\b/i.test(label.trim())) continue;
    const match = label.match(new RegExp(String.raw`(?:\(|\[|\s)(${unit})(?:\)|\])?\s*$`, "i"));
    if (match && (/[([]/.test(match[0]) || /^(?:IDR|USD|SGD|EUR|GBP|AUD|CAD|CHF|JPY|CNY|HKD|MYR|NZD|THB|SAR|AED|INR|KRW|Rp\.?|Rupiah)$/i.test(match[1]))) add(match[1]);
  }
  const currencyColumns = headers.flatMap((label, index) => CURRENCY_HEADER.test(label.trim()) ? [index] : []);
  for (const row of rows) for (const column of currencyColumns) {
    const value = (row[column] ?? "").trim();
    if (!value || value === "-" || CURRENCY_HEADER.test(value)) continue;
    if (!new RegExp(String.raw`^${unit}$`, "i").test(value)) {
      throw new SourceCurrencyError("Mata uang pada kolom sumber tidak dikenali. Periksa rekening koran sebelum mengimpor.");
    }
    add(value);
  }
  for (const value of amounts) {
    const match = value.trim().match(new RegExp(String.raw`^(${unit})\s*[+-]?[\d(]|[\d)]\s*(${unit})$`, "i"));
    if (match) add(match[1] ?? match[2]);
    if (/[$€£¥]/.test(value)) found.add("NON-IDR");
  }
  if (found.size > 1) throw new SourceCurrencyError(`Mata uang sumber bertentangan (${[...found].join(", ")}). Pisahkan atau perbaiki rekening koran sebelum mengimpor.`);
  const currency = [...found][0];
  if (currency && currency !== "IDR") throw new SourceCurrencyError(`Mata uang ${currency} belum didukung untuk impor bank. Gunakan rekening koran IDR; nominal tidak dikonversi otomatis.`);
  return currency;
}


/** Strict bank-file grammar: separators are grouping or one decimal separator, never punctuation to silently discard. */
export function parseBankAmount(text: string | undefined | null): bigint {
  const original = text ?? "";
  let bare = original.trim();
  if (!bare || bare === "-") return 0n;
  if (/^\(.*\)$/.test(bare)) bare = bare.slice(1, -1).trim();
  bare = bare.replace(/^([+-]?)\s*(?:Rp\.?|IDR)\s*/i, "$1").replace(/\s/g, "");
  const plain = /^[+-]?\d+(?:[.,]\d{1,2})?$/;
  const grouped = /^[+-]?(?:\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?)$/;
  if (!plain.test(bare) && !grouped.test(bare)) throw new SourceAmountError(`Nominal sumber tidak valid: "${original}". Periksa angka dan pemisah ribu/desimal pada file.`);
  return parseRupiah(original);
}

/** One bank movement has one non-zero side. Check sen before whole-Rupiah rounding. */
export function assertSingleSide(debit: string | undefined, credit: string | undefined, row: number): void {
  const d = splitMarker(debit ?? "").text;
  const c = splitMarker(credit ?? "").text;
  parseBankAmount(d); parseBankAmount(c);
  if (parseCents(d) !== 0n && parseCents(c) !== 0n) throw new SourceAmountError(`Baris ${row}: Debet dan Kredit sama-sama berisi nominal. Pisahkan transaksi atau perbaiki file; kedua sisi tidak dinetokan otomatis.`);
}
