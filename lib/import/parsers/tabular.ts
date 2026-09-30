import ExcelJS from "exceljs";
import { parseRupiah } from "@/lib/money";
import { dateOnly } from "@/lib/format";
import type { BankCode } from "@/lib/generated/prisma/enums";
import { ParseError, YearNeededError, type ParsedRow, type ParsedStatement } from "@/lib/import/types";
import { closingFromRows, dateParts as baseDateParts, periodFromText, type DateParts } from "@/lib/import/parsers/common";
import { periodOf } from "@/lib/import/parsers/pdf";

/**
 * Mandiri (MCM/Livin' export, XLSX) and a generic column-detecting reader for any CSV/XLSX/XLS with recognisable headers
 * (tanggal / keterangan / debet / kredit / saldo) — including accountants' own working copies of a statement: one sheet per
 * month opening with a SALDO AWAL row, `dd/MM` dates without a year, debet = money in (the books' side), a formula balance.
 */
const HEADER_PATTERNS = {
  date: /^(tanggal|tgl|date|post(ing)? date|trans(action)? date)/i,
  desc: /(keterangan|deskripsi|description|\bdesc\b|remark|uraian|narasi|berita|detail transaksi|transaction detail)/i,
  debit: /^(debet|debit|mutasi debet|mutasi debit|(uang )?keluar|withdrawal|pengeluaran)/i,
  credit: /^(kredit|credit|mutasi kredit|(uang )?masuk|deposit|pemasukan)/i,
  amount: /^(jumlah|nominal|amount|mutasi)$/i,
  balance: /^(saldo|balance|sisa saldo)/i,
};
/** "Debit (IDR)", "Jumlah (Rp)", "Saldo (IDR)": the currency in brackets after a label isn't part of the label. */
const withoutUnit = (h: string) => h.replace(/\s*\((?:idr|rp\.?|rupiah|[a-z]{3})\)\s*$/i, "").trim();
const OPENING_ROW = /^(saldo\s*awal|opening\s*balance|beginning\s*balance|saldo\s*sebelumnya)\b/i;
const CLOSING_ROW = /^(saldo\s*akhir|closing\s*balance|ending\s*balance)\b/i;
const TOTAL_ROW = /^(total|jumlah|mutasi\s*(debet|debit|kredit|credit))\b/i;

export type Sheet = { name: string; rows: string[][] };

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString().slice(0, 10) : "";
  // Numbers are written back unambiguously ("1500000.50"), never as locale text a parser could misread.
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === "object" && "richText" in v) return v.richText.map((t) => t.text).join("");
  if (typeof v === "object" && "result" in v) return v.result === undefined || v.result === null ? "" : cellText(v.result as ExcelJS.CellValue);
  if (typeof v === "object" && "error" in v) return "";
  if (typeof v === "object" && "text" in v) return String((v as { text: unknown }).text);
  return String(v).trim();
}

/** Every sheet of an .xlsx; `rows[i]` is Excel row i + 1, so row numbers cite the file. */
export async function xlsxToSheets(buf: Buffer): Promise<Sheet[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new ParseError("File Excel tidak bisa dibuka. Simpan ulang sebagai .xlsx lalu coba lagi.");
  }
  if (!wb.worksheets.length) throw new ParseError("File Excel kosong");
  return wb.worksheets.map((ws) => {
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      // Array.from, not map: row.values is sparse and map would keep the holes (an unlabeled column would vanish).
      rows[n - 1] = Array.from((row.values as ExcelJS.CellValue[]).slice(1), cellText);
    });
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    return { name: ws.name, rows };
  });
}

export function isMandiriRows(rows: string[][]) {
  return rows.slice(0, 8).some((r) => /mandiri/i.test(r.join(" ")));
}

/** A sheet without a transaction header: skipped in a workbook (a cover or summary sheet), an error on its own. */
export class NoTableError extends ParseError {
  constructor() {
    super("Kolom tanggal & keterangan tidak ditemukan. Pastikan baris judul kolom ada.");
  }
}

/** Where year-less dates stand: the year and month of the last row read (carried from sheet to sheet). */
export type YearCursor = { year: number; month: number };

/** How the debet/kredit columns were read: the bank's way (kredit = masuk) or the books' way (debet = masuk). */
export type Direction = "BANK" | "BOOK";
/** What the running balance says: only one direction continuous, or it can't tell (too few balances, both or neither hold). */
export type DirectionVerdict = Direction | "UNKNOWN";

type Ctx = { sheet?: string; year?: number; fileName?: string; cursor?: YearCursor | null; direction?: Direction };
type Parsed = ParsedStatement & { cursor: YearCursor | null; verdict: DirectionVerdict };

const MONTHS = /\b(jan|feb|mar|apr|mei|may|jun|jul|agu|agt|aug|sep|okt|oct|nov|des|dec)[a-z]*[\s_'.-]*(\d{2})(?!\d)/i;

/** A prefill for the year question, from the file name only ("…_202608", "2026", "MAY_26"). Never used unconfirmed. */
export function guessYear(fileName: string | undefined): number | null {
  if (!fileName) return null;
  const n = fileName.replace(/\.[a-z0-9]+$/i, "");
  const ym = n.match(/(?<!\d)(20\d{2})(0[1-9]|1[0-2])(?!\d)/);
  if (ym) return Number(ym[1]);
  const y = n.match(/(?<!\d)(20\d{2})(?!\d)/);
  if (y) return Number(y[1]);
  const m = n.match(MONTHS);
  return m ? 2000 + Number(m[2]) : null;
}

const dateParts = (text: string) => baseDateParts(text, { serial: true });

function dateFrom(p: DateParts, cursor: YearCursor): Date {
  const d = dateOnly(p.y ?? cursor.year, p.m, p.d);
  if (d.getUTCMonth() + 1 !== p.m) throw new ParseError(`Tanggal tidak ada di kalender: ${p.d}/${p.m}/${p.y ?? cursor.year}`);
  return d;
}

/** The first run of digits (hyphens allowed) with six or more digits that isn't a dd-mm-yyyy / yyyy-mm-dd date. */
function accountIn(line: string): string | null {
  for (const m of line.matchAll(/\d[\d-]{4,}\d/g)) {
    if (/^(\d{1,2}-\d{1,2}-\d{2,4}|\d{4}-\d{1,2}-\d{1,2})$/.test(m[0])) continue;
    const digits = m[0].replace(/-/g, "");
    if (digits.length >= 6) return digits;
  }
  return null;
}

export function parseTabular(rows: string[][], format: BankCode, ctx: Ctx = {}): Parsed {
  // A header names the date and the description in two different cells (one unsplit line of a wrongly split file names both in one).
  const isHeader = (r: string[]) => {
    const d = r.findIndex((c) => HEADER_PATTERNS.date.test(withoutUnit(c)));
    return d >= 0 && r.some((c, i) => i !== d && HEADER_PATTERNS.desc.test(withoutUnit(c)));
  };
  const headerIdx = rows.findIndex(isHeader);
  if (headerIdx < 0) throw new NoTableError();
  const rawHeader = rows[headerIdx];
  const header = rawHeader.map(withoutUnit);
  const find = (re: RegExp) => header.findIndex((c) => re.test(c));
  const cDate = find(HEADER_PATTERNS.date);
  const cDesc = find(HEADER_PATTERNS.desc);
  const cDb = find(HEADER_PATTERNS.debit);
  const cCr = find(HEADER_PATTERNS.credit);
  const cAmt = find(HEADER_PATTERNS.amount);
  const cBal = find(HEADER_PATTERNS.balance);
  if ((cDb < 0 || cCr < 0) && cAmt < 0) throw new ParseError("Kolom debet/kredit atau jumlah tidak ditemukan");
  const split = cDb >= 0 && cCr >= 0;
  const money = [split ? cDb : -1, split ? cCr : -1, split ? -1 : cAmt, cBal].filter((c) => c >= 0);
  // The description, plus unlabeled text columns between the date and the first amount (e.g. the transaction type).
  const firstMoney = Math.min(...money);
  const descCols = [...new Set([cDesc, ...header.map((h, i) => (i > cDate && i < firstMoney && !h.trim() ? i : -1)).filter((i) => i >= 0)])]
    .filter((i) => i !== cDate && !money.includes(i))
    .sort((a, b) => a - b);

  let accountNumber: string | null = null;
  let period: { start: Date; end: Date } | null = null;
  for (const r of rows.slice(0, headerIdx)) {
    const line = r.join(" ");
    // "0000-01-000123-50-9" (BRI prints the number in groups): one number, hyphens dropped.
    if (/rekening|account/i.test(line)) accountNumber = accountIn(line) ?? accountNumber;
    period = periodFromText(line) ?? period;
  }
  period ??= periodOf(rows.slice(0, headerIdx).map((r) => r.join(" ")).join("\n"));
  const sheetYear = ctx.sheet?.match(/(?<!\d)(20\d{2})(?!\d)/)?.[1];

  type Draft = { parts: DateParts; description: string; debit: bigint; credit: bigint; amount: bigint; balance: bigint | null; rowNumber: number; rawRow: string };
  const drafts: Draft[] = [];
  let openingRow: { balance: bigint | null; parts: DateParts | null } | null = null;
  let printedClosing: bigint | null = null;
  const num = (r: string[], c: number) => (c >= 0 && r[c] ? parseRupiah(r[c]) : 0n);
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const dateText = r[cDate] ?? "";
    const text = descCols.map((c) => (r[c] ?? "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    // Movement from the parsed values: "0" or "0,00" in a SALDO AWAL row is no movement (unreadable text counts as movement).
    const isZero = (c: number) => {
      try {
        return num(r, c) === 0n;
      } catch {
        return false;
      }
    };
    const noMovement = split ? isZero(cDb) && isZero(cCr) : isZero(cAmt);
    const label = OPENING_ROW.test(dateText) || OPENING_ROW.test(text) ? "open" : CLOSING_ROW.test(dateText) || CLOSING_ROW.test(text) ? "close" : TOTAL_ROW.test(dateText) ? "total" : null;
    if (label && (noMovement || !dateParts(dateText))) {
      const bal = cBal >= 0 && r[cBal] ? parseRupiah(r[cBal]) : null;
      if (label === "open" && !openingRow) openingRow = { balance: bal, parts: dateParts(dateText) };
      if (label === "close" && bal !== null) printedClosing = bal;
      continue;
    }
    if (!dateText || /saldo|total/i.test(dateText)) continue;
    const parts = dateParts(dateText);
    if (!parts) throw new ParseError(`Format tanggal tidak dikenali di baris ${i + 1}: "${dateText}"`);
    // A dated row that moves no money is no transaction (it could never post); the rows around it carry the balance.
    if (noMovement) continue;
    const debit = split ? num(r, cDb) : 0n;
    const credit = split ? num(r, cCr) : 0n;
    drafts.push({
      parts,
      description: text,
      debit,
      credit,
      amount: split ? credit - debit : num(r, cAmt),
      balance: cBal >= 0 && r[cBal] ? parseRupiah(r[cBal]) : null,
      rowNumber: i + 1,
      rawRow: r.map((c) => c.replace(/\s+/g, " ").trim()).join(" | "),
    });
  }

  // ---- dates: the year comes from the content (period line, sheet name), else from the accountant (never guessed) ----
  const allParts = [...(openingRow?.parts ? [openingRow.parts] : []), ...drafts.map((d) => d.parts)];
  const yearless = allParts.some((p) => p.y === null);
  let cursor: YearCursor | null = ctx.cursor ?? null;
  if (yearless) {
    const first = allParts.find((p) => p.y === null)!;
    const contentYear = period ? period.start.getUTCFullYear() : sheetYear ? Number(sheetYear) : null;
    if (contentYear !== null) {
      // A Dec–Jan period: months before the period's first month belong to its end year.
      const start = period ? period.start.getUTCMonth() + 1 : first.m;
      cursor = { year: first.m < start && period ? period.end.getUTCFullYear() : contentYear, month: first.m };
    } else if (!cursor) {
      if (!ctx.year) throw new YearNeededError(guessYear(ctx.fileName));
      cursor = { year: ctx.year, month: first.m };
    }
  }
  const dateOf = (p: DateParts): Date => {
    if (p.y !== null) {
      cursor = { year: p.y, month: p.m };
      return dateFrom(p, cursor);
    }
    const c: YearCursor = cursor!;
    // A year-less month far behind the last one (Des → Jan, Nov → Feb) starts the next year; a row or two out of order doesn't.
    cursor = { year: c.month - p.m >= 6 ? c.year + 1 : c.year, month: p.m };
    return dateFrom(p, cursor);
  };
  const openingDate = openingRow?.parts ? dateOf(openingRow.parts) : null;
  const dates = drafts.map((d) => dateOf(d.parts));

  // ---- direction: the bank's way (kredit = masuk) unless only the books' way (debet = masuk) keeps the balance continuous ----
  const notes: string[] = [];
  const opening = (flip: boolean): bigint | null => {
    if (openingRow?.balance !== undefined && openingRow?.balance !== null) return openingRow.balance;
    const f = drafts[0];
    return f && f.balance !== null ? f.balance - (flip ? -f.amount : f.amount) : null;
  };
  const breaks = (flip: boolean) => {
    let running = opening(flip);
    let n = 0;
    for (const d of drafts) {
      running = running === null ? null : running + (flip ? -d.amount : d.amount);
      if (d.balance !== null) {
        if (running !== null && d.balance !== running) n++;
        running = d.balance;
      }
    }
    return n;
  };
  // Two balances to compare at least: the SALDO AWAL row counts as one.
  const checkpoints = drafts.filter((d) => d.balance !== null).length + (openingRow?.balance != null ? 1 : 0);
  const bankBreaks = checkpoints >= 2 ? breaks(false) : -1;
  const bookBreaks = checkpoints >= 2 ? breaks(true) : -1;
  const verdict: DirectionVerdict = bankBreaks > 0 && bookBreaks === 0 ? "BOOK" : bankBreaks === 0 && bookBreaks > 0 ? "BANK" : "UNKNOWN";
  // A workbook passes its decision to the sheets that can't tell on their own.
  const flip = (ctx.direction ?? verdict) === "BOOK";
  if (flip) {
    notes.push(
      split
        ? "Kolom Debet dibaca sebagai uang masuk (sudut pandang pembukuan): hanya dengan cara itu saldo berjalan nyambung."
        : "Tanda kolom jumlah dibalik (positif = uang keluar): hanya dengan cara itu saldo berjalan nyambung.",
    );
  }

  const parsed: ParsedRow[] = drafts.map((d, k) => ({
    date: dates[k],
    description: d.description,
    amount: flip ? -d.amount : d.amount,
    balance: d.balance,
    rowNumber: d.rowNumber,
    rawRow: d.rawRow,
    ...(ctx.sheet ? { sheet: ctx.sheet } : {}),
  }));
  const openingBalance = opening(flip);
  if (openingBalance === null) {
    if (!parsed.length) throw new ParseError("File tidak berisi transaksi");
    throw new ParseError("Saldo awal tidak dapat ditentukan (tidak ada baris SALDO AWAL dan kolom saldo kosong)");
  }
  const anchor = dates[0] ?? openingDate;
  if (!anchor) throw new ParseError("File tidak berisi transaksi");
  const last = dates.at(-1) ?? anchor;
  const bounds = period ?? {
    start: dateOnly(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1),
    end: new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 0)),
  };
  return {
    format,
    accountNumber,
    periodStart: bounds.start,
    periodEnd: bounds.end,
    openingBalance,
    closingBalance: printedClosing ?? closingFromRows(parsed, openingBalance),
    rows: parsed,
    notes,
    ...(ctx.sheet ? { sheets: [ctx.sheet] } : {}),
    cursor,
    verdict,
  };
}

/**
 * A workbook: each sheet with a transaction table is read on its own, in workbook order (year-less dates carry the year from
 * sheet to sheet). Sheets of the same account (same number, or none) are one statement, joined in date order: opening of the
 * first, closing of the last, and the running-balance check runs across the sheet boundary. Different account numbers stay
 * separate sections, like a combined PDF.
 */
export function parseWorkbook(sheets: Sheet[], ctx: { year?: number; fileName?: string } = {}): ParsedStatement[] {
  const read: { sheet: Sheet; cursorIn: YearCursor | null; st: Parsed }[] = [];
  let cursor: YearCursor | null = null;
  let firstError: ParseError | null = null;
  for (const s of sheets) {
    try {
      const st = parseTabular(s.rows, isMandiriRows(s.rows) ? "MANDIRI" : "GENERIC", { sheet: s.name, year: ctx.year, fileName: ctx.fileName, cursor });
      read.push({ sheet: s, cursorIn: cursor, st });
      cursor = st.cursor;
    } catch (e) {
      if (!(e instanceof NoTableError)) throw e;
      firstError ??= e;
    }
  }
  if (!read.length) throw firstError ?? new NoTableError();
  const digits = (s: string | null) => (s ?? "").replace(/\D/g, "");
  // Sheets without an account number belong to the one account the others print; with several accounts they are ambiguous.
  const numbered = [...new Set(read.map((r) => digits(r.st.accountNumber)).filter(Boolean))];
  const unnumbered = read.filter((r) => !digits(r.st.accountNumber));
  if (unnumbered.length && numbered.length > 1) {
    throw new ParseError(`Lembar ${unnumbered.map((r) => r.sheet.name).join(", ")} tidak mencantumkan nomor rekening, sementara lembar lain berisi beberapa rekening (${numbered.join(", ")}). Pisahkan file per rekening atau tulis nomor rekening di tiap lembar.`);
  }
  const keyOf = (r: (typeof read)[number]) => digits(r.st.accountNumber) || (numbered[0] ?? "");
  const groups = new Map<string, typeof read>();
  for (const r of read) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
  const joined = [...groups.values()].map((group) => {
    // One account's sheets follow one convention: sheets that can't tell take the one the others show.
    const verdicts = new Set(group.map((g) => g.st.verdict).filter((v) => v !== "UNKNOWN"));
    const decided = verdicts.size === 1 ? ([...verdicts][0] as Direction) : null;
    const parts = group.map(({ sheet, cursorIn, st }) =>
      decided && st.verdict === "UNKNOWN"
        ? parseTabular(sheet.rows, st.format, { sheet: sheet.name, year: ctx.year, fileName: ctx.fileName, cursor: cursorIn, direction: decided })
        : st,
    );
    const st = join(parts.map(({ cursor: _c, verdict: _v, ...p }) => (void _c, void _v, p)));
    if (verdicts.size > 1) {
      const book = group.filter((g) => g.st.verdict === "BOOK").map((g) => g.sheet.name);
      (st.notes ??= []).push(`Arah debet/kredit berbeda antar lembar: ${book.join(", ")} dibaca sebagai pembukuan, lembar lain sebagai bank. Periksa file sumbernya.`);
    }
    return st;
  });
  if (joined.length === 1) return joined;
  return joined.map((st) => ({ ...st, section: { label: (st.sheets ?? []).join(", "), currency: "IDR" } }));
}

function join(parts: ParsedStatement[]): ParsedStatement {
  if (parts.length === 1) return parts[0];
  const sorted = [...parts].sort((a, b) => +a.periodStart - +b.periodStart);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const sheets = sorted.flatMap((p) => p.sheets ?? []);
  const notes = [...new Set(sorted.flatMap((p) => p.notes ?? []))];
  notes.unshift(`${sheets.length} lembar dibaca sebagai satu rekening koran: ${sheets.join(", ")}.`);
  return {
    format: sorted.every((p) => p.format === first.format) ? first.format : "GENERIC",
    accountNumber: first.accountNumber ?? sorted.find((p) => p.accountNumber)?.accountNumber ?? null,
    periodStart: first.periodStart,
    periodEnd: last.periodEnd,
    openingBalance: first.openingBalance,
    closingBalance: last.closingBalance,
    rows: sorted.flatMap((p) => p.rows),
    notes,
    sheets,
  };
}
