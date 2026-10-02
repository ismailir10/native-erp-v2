import ExcelJS from "exceljs";
import { dateOnly } from "@/lib/format";
import { parseCents } from "@/lib/money";
import { normalizeLedgerRate } from "@/lib/fx/currency";
import { readCsv } from "@/lib/import/parsers/common";
import { ParseError } from "@/lib/import/types";
import { readableXlsx, sniffFile } from "@/lib/import/workbook";
import type { AccountType } from "@/lib/generated/prisma/enums";
import type { Columns, ColumnKey, LedgerRow, NeracaRow, NeracaTotal, RawCell, RawSheet, ReadResult, TableCandidate } from "@/lib/ledger-import/types";
import { NO_CODE_PREFIX } from "@/lib/ledger-import/code";

/**
 * Ledger / Neraca files (XLSX, legacy/HTML XLS, CSV/TSV) → rows with `sheet!row` references. No DB, no AI (accounting-rules §15a, §16):
 * the table is found by header names from content, and every problem reading a row is kept on the row for the checks.
 */

const HEADERS: Record<ColumnKey, RegExp> = {
  date: /^(tanggal|tgl\.?|date|entry date|posting date|tanggal transaksi|tanggal jurnal|transaction date)$/i,
  code: /^(kode akun|kode perkiraan|kode|no\.? akun|nomor akun|account code|account no\.?|account number|acc(ount)? code|coa)$/i,
  name: /^(nama akun|nama perkiraan|perkiraan|account name|account|akun|nama)$/i,
  debit: /^(debit|debet|dr|mutasi debit|mutasi debet)(\s*\(.*\))?$/i,
  credit: /^(kredit|credit|cr|mutasi kredit)(\s*\(.*\))?$/i,
  amount: /^(saldo|saldo akhir|jumlah|nilai|balance|amount|closing balance|ending balance)$/i,
  level: /^(level|lvl|tingkat)$/i,
  desc: /^(keterangan|deskripsi|description|uraian|memo|narration|reconstruction logic \/ description)$/i,
  voucher: /^(no\.? bukti|nomor bukti|voucher|no\.? voucher|no\.? jurnal|nomor jurnal|journal no\.?|journal number|transaction no\.?|no\.? transaksi)$/i,
  entity: /^(entitas|entity|perusahaan|company)$/i,
  currency: /^(mata uang|currency|ccy|valuta|curr\.?)$/i,
  rate: /^(kurs|rate|exchange rate|fx rate)$/i,
  notes: /^(notes|catatan|note)$/i,
};
const DATE_HEADER = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/;
/** Account codes contain a digit: "1-1000", "11001", "7-PF-BANK TRANSFER BCA", "SKP-UNM-01" — never a heading like "Long-term Liability". */
const CODE = /^(?=[^ ]*\d)[0-9A-Za-z][0-9A-Za-z.\-_/]*$|^\d+-[0-9A-Za-z\-_. ]+$|^\d+(?: \d+)+$/;
const EXCEL_ERROR = /^#(VALUE!|REF!|NAME\?|DIV\/0!|N\/A|NULL!|NUM!|ERROR!|SPILL!|CALC!)$/i;

// ─── Workbook → raw sheets ────────────────────────────────────────────────────

function toRaw(v: ExcelJS.CellValue): RawCell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return String(v);
  if (typeof v === "string") return EXCEL_ERROR.test(v.trim()) ? { error: v.trim() } : v;
  if (typeof v === "object") {
    if ("error" in v && v.error) return { error: String(v.error) };
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("formula" in v || "sharedFormula" in v) {
      const r = (v as { result?: ExcelJS.CellValue }).result;
      return r === undefined ? null : toRaw(r);
    }
    if ("text" in v) return String((v as { text: unknown }).text);
    if ("hyperlink" in v) return String((v as { hyperlink: unknown }).hyperlink);
  }
  return String(v);
}

/** The file's kind comes from its bytes (a `.xls` may be old Excel, an HTML table or text); the name is only shown. */
export async function readSheets(_fileName: string, data: Buffer): Promise<RawSheet[]> {
  if (sniffFile(data) === "PDF") throw new ParseError("File PDF tidak bisa dibaca sebagai buku besar atau neraca. Unggah XLSX, XLS, atau CSV.");
  const xlsx = await readableXlsx(data);
  if (xlsx) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
    } catch {
      throw new ParseError("File Excel tidak bisa dibuka. Simpan ulang sebagai .xlsx lalu coba lagi.");
    }
    return wb.worksheets.map((ws) => {
      const rows: RawCell[][] = [];
      ws.eachRow({ includeEmpty: true }, (row, n) => {
        rows[n - 1] = (row.values as ExcelJS.CellValue[]).slice(1).map(toRaw);
      });
      for (let i = 0; i < rows.length; i++) rows[i] ??= [];
      return { name: ws.name, rows };
    });
  }
  const text = data.toString("utf8");
  const first = text.split("\n")[0];
  const delimiter = first.includes("\t") ? "\t" : first.includes(";") ? ";" : ",";
  return [{ name: "CSV", rows: readCsv(text, delimiter).map((r) => r.map((c) => (c === "" ? null : EXCEL_ERROR.test(c) ? { error: c } : c))) }];
}

// ─── Cell helpers ─────────────────────────────────────────────────────────────

export function cellText(c: RawCell | undefined): string {
  if (c === null || c === undefined) return "";
  // Excel can store a date cell ExcelJS can't convert (Invalid Date); treat it as text that no reader matches.
  if (c instanceof Date) return Number.isFinite(c.getTime()) ? c.toISOString().slice(0, 10) : "[tanggal tidak valid]";
  if (typeof c === "object") return c.error;
  return String(c).trim();
}

function isBlank(c: RawCell | undefined) {
  return cellText(c) === "";
}

/** Signed sen, or an error string when the cell isn't a number. Blank = 0. */
function cellCents(c: RawCell | undefined): bigint | string {
  if (c === null || c === undefined) return 0n;
  if (typeof c === "object" && !(c instanceof Date)) return c.error;
  if (c instanceof Date) return "tanggal, bukan angka";
  try {
    return parseCents(c);
  } catch {
    return `"${String(c).slice(0, 30)}"`;
  }
}

export function cellDate(c: RawCell | undefined): Date | null {
  if (c instanceof Date) return Number.isFinite(c.getTime()) ? dateOnly(c.getUTCFullYear(), c.getUTCMonth() + 1, c.getUTCDate()) : null;
  const t = cellText(c).replace(/^'/, "");
  // A calendar-impossible date (31/02/1990) is unreadable, never rolled into the next month.
  const real = (y: number, mo: number, d: number) => {
    const out = dateOnly(y, mo, d);
    return out.getUTCFullYear() === y && out.getUTCMonth() + 1 === mo && out.getUTCDate() === d ? out : null;
  };
  let m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return real(Number(m[3]), Number(m[2]), Number(m[1]));
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return real(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

// ─── Table detection ──────────────────────────────────────────────────────────

/** ERP exports head the amount column "Value"; alone that word says little (pivots), so it counts only beside a "Level" column. */
const VALUE_HEADER = /^value$/i;
const hasLevelHeader = (row: RawCell[]) => row.some((c) => HEADERS.level.test(cellText(c).replace(/\s+/g, " ")));
const headerKey = (t: string, withValue: boolean): ColumnKey | undefined => (Object.keys(HEADERS) as ColumnKey[]).find((k) => HEADERS[k].test(t)) ?? (withValue && VALUE_HEADER.test(t) ? "amount" : undefined);

function headerColumns(row: RawCell[]): Columns {
  const cols: Columns = {};
  const withValue = hasLevelHeader(row);
  row.forEach((c, i) => {
    const t = cellText(c).replace(/\s+/g, " ");
    if (!t) return;
    for (const key of Object.keys(HEADERS) as ColumnKey[]) {
      if (cols[key] === undefined && HEADERS[key].test(t)) {
        cols[key] = i;
        return;
      }
    }
    if (cols.amount === undefined && (DATE_HEADER.test(t) || (withValue && VALUE_HEADER.test(t)))) cols.amount = i;
  });
  return cols;
}

/**
 * A Neraca printed as two panels side by side (Aset | Kewajiban + Ekuitas) repeats its whole column set on one header row.
 * Split only when every part is a complete Neraca table on its own (account + amount, no date), so a header that merely repeats one
 * word ("Date" … "Transaction Date") stays one table.
 */
function headerPanels(row: RawCell[]): Columns[] {
  const parts: Columns[] = [{}];
  const withValue = hasLevelHeader(row);
  row.forEach((c, i) => {
    const t = cellText(c).replace(/\s+/g, " ");
    if (!t) return;
    const key = headerKey(t, withValue);
    if (!key) return;
    let cur = parts[parts.length - 1];
    if (cur[key] !== undefined) {
      cur = {};
      parts.push(cur);
    }
    cur[key] = i;
  });
  const whole = (p: Columns) => p.date === undefined && (p.code !== undefined || p.name !== undefined) && p.amount !== undefined;
  return parts.length > 1 && parts.every(whole) ? parts : [];
}

const SPACED_CODE = /^\d+(?: \d+)+$/;

/** ERP exports name the code column "Account" and the words "Description": read them as code and name when the "name" column holds codes. */
function codesInNameColumn(rows: RawCell[][], headerRow: number, cols: Columns): Columns {
  if (cols.code !== undefined || cols.name === undefined || cols.desc === undefined) return cols;
  const cells = rows.slice(headerRow + 1, headerRow + 41).map((r) => cellText(r?.[cols.name!])).filter(Boolean);
  if (cells.length < 3 || cells.filter((t) => CODE.test(t) || SPACED_CODE.test(t)).length < cells.length * 0.6) return cols;
  const { desc, ...rest } = cols;
  return { ...rest, code: cols.name, name: desc };
}

const REPORT_TITLES: [RegExp, "LABA_RUGI" | "ARUS_KAS"][] = [
  [/^(laporan )?(laba rugi|laba\/rugi|profit (&|and) loss|profit and loss statement|income statement|statement of profit or loss)$/i, "LABA_RUGI"],
  [/^(laporan )?(arus kas|cash ?flows?|statement of cash flows?)$/i, "ARUS_KAS"],
];
/**
 * ERP exports prefix or suffix the title ("PnL Profit Loss Report", "All Branch Profit Loss Report"): a short row of at most three cells that
 * calls itself a report/laporan/statement and does not name ledger accounts ("Buku Besar Akun Laba Rugi" is a ledger of P&L accounts).
 */
const REPORT_WORD = /\b(report|laporan|statement)\b/i;
const LEDGER_WORD = /(ledger|buku besar|\bakun\b|accounts?\b|ikhtisar|mutasi)/i;
const LOOSE_TITLES: [RegExp, "LABA_RUGI" | "ARUS_KAS"][] = [
  [/\b(laba rugi|profit\s*(&|and)?\s*loss|income statement)\b/i, "LABA_RUGI"],
  [/\b(arus kas|cash ?flows?)\b/i, "ARUS_KAS"],
];

/** A sheet whose title rows (the first 8, as accounting systems print them) name a Laba Rugi or Arus Kas report — never a Neraca to post. */
export function reportKind(sheet: RawSheet): "LABA_RUGI" | "ARUS_KAS" | null {
  for (const row of sheet.rows.slice(0, 8)) {
    const text = cellText((row ?? []).find((c) => !isBlank(c)) ?? null);
    const hit = REPORT_TITLES.find(([re]) => re.test(text));
    if (hit) return hit[1];
    const short = text.length <= 60 && (row ?? []).filter((c) => !isBlank(c)).length <= 3 && REPORT_WORD.test(text) && !LEDGER_WORD.test(text) && !/\b(balance|neraca|posisi keuangan)\b/i.test(text);
    const loose = short ? LOOSE_TITLES.find(([re]) => re.test(text)) : undefined;
    if (loose) return loose[1];
  }
  return null;
}

/** Every sheet region that looks like a ledger (date + account + debit/credit) or a Neraca (account + amount). */
export function detectTables(sheets: RawSheet[]): TableCandidate[] {
  const out: TableCandidate[] = [];
  for (const sheet of sheets) {
    if (reportKind(sheet)) continue;
    const limit = Math.min(sheet.rows.length, 30);
    let found = false;
    for (let r = 0; r < limit && !found; r++) {
      const cols = headerColumns(sheet.rows[r] ?? []);
      const hasAccount = cols.code !== undefined || cols.name !== undefined;
      const hasDrCr = cols.debit !== undefined && cols.credit !== undefined;
      const dataRows = sheet.rows.slice(r + 1).filter((row) => row && row.some((c) => !isBlank(c))).length;
      if (cols.date !== undefined && hasAccount && hasDrCr && dataRows > 0) {
        out.push({ sheet: sheet.name, headerRow: r, mode: "LEDGER", columns: cols, dataRows });
        found = true;
      } else if (cols.date === undefined && hasAccount && (cols.amount !== undefined || hasDrCr) && dataRows > 0) {
        const panels = headerPanels(sheet.rows[r] ?? []).map((p) => codesInNameColumn(sheet.rows, r, p));
        if (panels.length > 1) out.push({ sheet: sheet.name, headerRow: r, mode: "NERACA", columns: panels[0], panels, dataRows });
        else out.push({ sheet: sheet.name, headerRow: r, mode: "NERACA", columns: codesInNameColumn(sheet.rows, r, cols), dataRows });
        found = true;
      }
    }
    if (!found) {
      const jurnal = detectJurnalNeraca(sheet);
      if (jurnal) out.push(jurnal);
    }
  }
  return out;
}

/**
 * Jurnal (Mekari) Neraca exports have no "kode akun" header: a "Date | | 31/05/2026" row, then
 * `code | name | amount` rows under section headings. Found by shape, not by file name.
 */
function detectJurnalNeraca(sheet: RawSheet): TableCandidate | null {
  const limit = Math.min(sheet.rows.length, 30);
  for (let r = 0; r < limit; r++) {
    const row = sheet.rows[r] ?? [];
    const dateCol = row.findIndex((c, i) => i > 0 && (DATE_HEADER.test(cellText(c)) || c instanceof Date));
    if (dateCol < 0) continue;
    const coded = sheet.rows.slice(r + 1).filter((x) => x && CODE.test(cellText(x[0])) && !isBlank(x[1]) && typeof cellCents(x[dateCol]) === "bigint").length;
    if (coded >= 3) return { sheet: sheet.name, headerRow: r, mode: "NERACA", columns: { code: 0, name: 1, amount: dateCol }, dataRows: coded };
  }
  return null;
}

// ─── Readers ──────────────────────────────────────────────────────────────────

const RATE_NOTE = /\b(?:rate|kurs)\s*[:=]\s*([0-9][0-9.,]*)/i;

export function readLedger(sheet: RawSheet, t: TableCandidate): LedgerRow[] {
  const c = t.columns;
  const rows: LedgerRow[] = [];
  for (let r = t.headerRow + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    if (row.every(isBlank)) continue;
    const get = (k: ColumnKey) => (c[k] === undefined ? undefined : row[c[k]!]);
    const code = cellText(get("code"));
    const name = cellText(get("name"));
    const dateCell = get("date");
    const debitCell = get("debit");
    const creditCell = get("credit");
    // Section/total/banner rows: no account and no amounts.
    if (!code && !name && isBlank(debitCell) && isBlank(creditCell)) continue;
    if (/^total\b/i.test(code || name) && isBlank(dateCell)) continue;

    const errors: string[] = [];
    const date = cellDate(dateCell);
    if (!date) errors.push(isBlank(dateCell) ? "tanggal kosong" : `tanggal tidak dikenali: ${cellText(dateCell)}`);
    if (!code && !name) errors.push("akun kosong");
    const debit = cellCents(debitCell);
    const credit = cellCents(creditCell);
    if (typeof debit === "string") errors.push(`debit bukan angka: ${debit}`);
    if (typeof credit === "string") errors.push(`kredit bukan angka: ${credit}`);
    let d = typeof debit === "bigint" ? debit : 0n;
    let k = typeof credit === "bigint" ? credit : 0n;
    // Negative amounts belong on the other side.
    if (d < 0n) [d, k] = [0n, k - d];
    if (k < 0n) [d, k] = [d - k, 0n];
    const notes = cellText(get("notes"));
    const rateText = cellText(get("rate")) || notes.match(RATE_NOTE)?.[1] || "";
    rows.push({
      ref: `${sheet.name}!${r + 1}`,
      row: r + 1,
      date,
      entity: cellText(get("entity")) || null,
      code: code || name,
      name: name || code,
      debit: d,
      credit: k,
      currency: cellText(get("currency")).toUpperCase() || null,
      rate: rateText ? normalizeLedgerRate(rateText) : null,
      description: cellText(get("desc")).replace(/\s+/g, " ").slice(0, 300),
      voucher: cellText(get("voucher")) || null,
      errors,
    });
  }
  return rows;
}

const SECTION_ASSET = /^(assets?|aset|aktiva|harta)\b/i;
/**
 * Asset sub-headings that can open a Neraca on their own ("Current Assets" with no "Assets" row above): they are ASET too. Every one
 * but "Current" is long-term, and TERM_NON_CURRENT matches the same words in singular and plural.
 */
const SECTION_ASSET_SUB = /^(current|fixed|other|non.?current|intangible|tangible)\s+(assets?)\b/i;
const SECTION_LIAB = /^(liabilit|kewajiban|utang|hutang|current liabilit|long-term liabilit)/i;
const SECTION_EQUITY = /^(equity|ekuitas|modal)\b/i;
const SECTION_LIAB_EQUITY = /(liabilit.*(equity|ekuitas)|kewajiban.*(ekuitas|modal)|pasiva)/i;
/** Sub-headings that say how long a balance runs (Jurnal: "Current Assets", "Fixed Assets", "Long-term Liability"). */
const TERM_NON_CURRENT = /(long.?term|jangka panjang|non.?current|tidak lancar|(fixed|other|intangible|tangible)\s+assets?|aset tetap|aktiva tetap|tak berwujud|tidak berwujud|aset lain|depreciation|penyusutan|amorti)/i;
const TERM_CURRENT = /(\bcurrent\b|\blancar\b|jangka pendek|short.?term)/i;

/** "Periode", "Per", "As of", or a bare "Tanggal"/"Date" — not "Tanggal Cetak" / "Date printed". */
const PERIOD_LABEL = /^(period|periode|per|as of|as at|tanggal|date|posisi)\s*:?$/i;

/** The Neraca date: the amount header when it is a date, else a date beside a "Periode/Period/Per" label, else the first date above the table. */
function neracaDate(sheet: RawSheet, t: TableCandidate): Date | null {
  const header = sheet.rows[t.headerRow] ?? [];
  const fromHeader = t.columns.amount !== undefined ? cellDate(header[t.columns.amount]) : null;
  if (fromHeader) return fromHeader;
  const above = sheet.rows.slice(0, t.headerRow);
  for (const row of above) {
    const cells = row ?? [];
    if (!PERIOD_LABEL.test(cellText(cells[0]))) continue;
    for (const cell of cells.slice(1)) {
      const d = cellDate(cell);
      if (d) return d;
    }
  }
  for (const row of above) for (const cell of row ?? []) {
    const d = cellDate(cell);
    if (d) return d;
  }
  return null;
}

/** Excel column letters of a 0-based index (0 → A, 26 → AA). */
function columnLetter(i: number): string {
  let n = i + 1;
  let out = "";
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function readNeraca(sheet: RawSheet, t: TableCandidate): { date: Date | null; rows: NeracaRow[]; totals: NeracaTotal[] } {
  const date = neracaDate(sheet, t);
  const panels = t.panels?.length ? t.panels : [t.columns];
  const rows: NeracaRow[] = [];
  const totals: NeracaTotal[] = [];
  for (const c of panels) {
    // A side-by-side file keeps each panel's column in the ref so two rows on the same sheet row stay distinguishable.
    const at = (r: number) => `${sheet.name}!${panels.length > 1 ? columnLetter(c.code ?? c.name ?? 0) : ""}${r + 1}`;
    let section: AccountType | null = null;
    let term: NeracaRow["termHint"] = null;
    const body = sheet.rows.slice(t.headerRow + 1);
    const levelOf = (row: RawCell[] | undefined) => {
      const text = c.level !== undefined ? cellText(row?.[c.level]) : "";
      const n = text === "" ? NaN : Number(text);
      return Number.isFinite(n) ? n : null;
    };
    for (let r = t.headerRow + 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r] ?? [];
      if (row.every(isBlank)) continue;
      const codeCell = c.code !== undefined ? cellText(row[c.code]) : "";
      const nameCell = c.name !== undefined ? cellText(row[c.name]) : "";
      // A panel that ends before the other one leaves its cells blank on the remaining rows.
      if (panels.length > 1 && !codeCell && !nameCell && isBlank(c.amount !== undefined ? row[c.amount] : undefined)) continue;
      const label = codeCell && !CODE.test(codeCell) ? codeCell : nameCell;
      const hasCode = !!codeCell && CODE.test(codeCell);
      const amountCell = c.amount !== undefined ? row[c.amount] : undefined;
      const raw = c.amount !== undefined ? cellCents(amountCell) : (() => {
        const d = cellCents(row[c.debit!]);
        const k = cellCents(row[c.credit!]);
        return typeof d === "string" ? d : typeof k === "string" ? k : d - k;
      })();

      // A coded group row of a hierarchical chart (zero value, next row one level deeper) is a heading, not an account.
      const level = levelOf(row);
      const isGroup = hasCode && level !== null && raw === 0n && (() => {
        for (const next of body.slice(r - t.headerRow)) {
          if (!next || (c.code !== undefined && !CODE.test(cellText(next[c.code])))) continue;
          const nl = levelOf(next);
          return nl !== null && nl > level;
        }
        return false;
      })();

      if (isGroup || (!hasCode && isBlank(amountCell) && (c.amount !== undefined || (isBlank(row[c.debit!]) && isBlank(row[c.credit!]))))) {
        // Section heading. A new main section resets the term; a sub-heading ("Fixed Assets") sets it.
        const before: AccountType | null = section;
        const headingTerm = TERM_NON_CURRENT.test(label) ? "NON_CURRENT" : TERM_CURRENT.test(label) ? "CURRENT" : null;
        if (SECTION_LIAB_EQUITY.test(label) || SECTION_LIAB.test(label)) section = "LIABILITAS";
        else if (SECTION_EQUITY.test(label)) section = "EKUITAS";
        else if (SECTION_ASSET.test(label) || SECTION_ASSET_SUB.test(label)) section = "ASET";
        if (section !== before) term = headingTerm;
        else if (headingTerm) term = headingTerm;
        continue;
      }
      if (/^(total|jumlah)\b/i.test(label) && !hasCode) {
        if (typeof raw === "bigint") {
          const kind = SECTION_LIAB_EQUITY.test(label) ? "LIAB_EQUITY" : /^(total|jumlah)\s+(assets?|aset|aktiva)$/i.test(label) ? "ASSETS" : "OTHER";
          totals.push({ ref: at(r), label, amount: raw, kind });
        }
        continue;
      }
      if (typeof raw === "bigint" && raw === 0n && !hasCode) continue;
      const errors: string[] = [];
      if (typeof raw === "string") errors.push(`saldo bukan angka: ${raw}`);
      const cents = typeof raw === "bigint" ? raw : 0n;
      // Presentation sign → debit-positive: assets as shown; liabilities & equity flipped.
      const debitPositive = c.amount === undefined ? cents : section === "LIABILITAS" || section === "EKUITAS" ? -cents : cents;
      const typeHint: AccountType | null = section === "LIABILITAS" && SECTION_EQUITY.test(nameCell) ? "EKUITAS" : section;
      rows.push({
        ref: at(r),
        row: r + 1,
        code: hasCode ? codeCell : `${NO_CODE_PREFIX}${label}`,
        name: hasCode ? nameCell || codeCell : label,
        amount: debitPositive,
        typeHint: guessEquity(label, typeHint),
        termHint: guessEquity(label, typeHint) === "EKUITAS" ? null : term,
        coded: hasCode,
        errors,
      });
    }
  }
  return { date, rows, totals };
}

/** Uncoded "Current Period Earnings" / "Laba tahun berjalan" rows sit in equity even under a combined L&E heading. */
function guessEquity(label: string, t: AccountType | null): AccountType | null {
  if (t === "LIABILITAS" && /(earning|laba|retained|capital|modal|saham|share|premium|agio|dividen|comprehensive)/i.test(label)) return "EKUITAS";
  return t;
}

export function readTable(sheets: RawSheet[], t: TableCandidate): ReadResult {
  const sheet = sheets.find((s) => s.name === t.sheet);
  if (!sheet) throw new ParseError(`Sheet "${t.sheet}" tidak ditemukan`);
  if (t.mode === "LEDGER") return { mode: "LEDGER", sheet: t.sheet, rows: readLedger(sheet, t) };
  return { mode: "NERACA", sheet: t.sheet, ...readNeraca(sheet, t) };
}
