import { detectBank } from "@/lib/banks";
import { dateOnly } from "@/lib/format";
import { parseBankAmount, assertSingleSide, sourceCurrency, chronologicalOrder, closingFromRows, dateParts, dayMonthEvidence, monthBoundsOf, openingFromBalances, splitMarker, type DayMonthOrder } from "@/lib/import/parsers/common";
import { guessYear } from "@/lib/import/parsers/tabular";
import { layoutSignature, sameRow, type Grid, type GridSheet } from "@/lib/import/grid";
import { ParseError, SourceAmountError, SourceCurrencyError, SourceDateError, UnreadableFileError, YearNeededError, type ParsedRow, type ParsedStatement } from "@/lib/import/types";

/**
 * *Atur kolom*: the accountant's reading of a file Buku's readers don't know. Columns are 0-based indexes of the grid (`lib/import/grid.ts`),
 * rows are the grid's 1-based row numbers. Deterministic: the same file and mapping always read the same rows, and every row is then proved
 * by its running balance: a first mapping only imports once its draft proves on *Periksa baris*; a file read with a remembered layout goes
 * through the import's continuity check like any file (a misread shows as *Ada celah*, as for the generic reader).
 */
export type AmountMapping =
  | { style: "split"; debit: number; credit: number }
  /** One amount column; its direction from a separate column (D/K, DB/CR, Debet/Kredit), else from a marker in the cell, else from its sign. */
  | { style: "signed"; column: number; direction: number | null };

export type ColumnMapping = {
  /** Workbook sheet (null for CSV and PDF). */
  sheet: string | null;
  /** The first transaction row; the header is the row above it when that row names columns. */
  firstRow: number;
  date: number;
  description: number[];
  amount: AmountMapping;
  balance: number;
  order: DayMonthOrder;
  /** For dates printed without a year: the year of the first month. */
  year?: number | null;
};

export const MAX_COLUMNS = 40;

/**
 * A mapping as the browser sends it (JSON), reduced to the shape `ColumnMapping` declares — integers where columns and rows go, the known
 * amount styles, DMY/MDY. Anything else is refused; whether the columns exist is `checkMapping`'s job, against the file itself.
 */
export function mappingFromJson(text: string): ColumnMapping {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new ParseError("Pemetaan kolom tidak terbaca. Muat ulang halaman lalu coba lagi.");
  }
  const o = (v ?? {}) as Record<string, unknown>;
  const int = (x: unknown) => (Number.isInteger(x) ? (x as number) : -1);
  const a = (o.amount ?? {}) as Record<string, unknown>;
  const amount: AmountMapping =
    a.style === "split" ? { style: "split", debit: int(a.debit), credit: int(a.credit) } : { style: "signed", column: int(a.column), direction: a.direction === null || a.direction === undefined ? null : int(a.direction) };
  return {
    sheet: typeof o.sheet === "string" ? o.sheet.slice(0, 200) : null,
    firstRow: int(o.firstRow),
    date: int(o.date),
    description: Array.isArray(o.description) ? o.description.slice(0, MAX_COLUMNS).map(int) : [],
    amount,
    balance: int(o.balance),
    order: o.order === "MDY" ? "MDY" : "DMY",
    year: o.year === null || o.year === undefined || o.year === "" ? null : int(Number(o.year)),
  };
}

/** The mapping is the accountant's, sent from the browser: refused unless every column it names exists and no column has two jobs. */
export function checkMapping(m: ColumnMapping, grid: Grid): GridSheet {
  const sheet = grid.kind === "XLSX" ? grid.sheets.find((s) => s.name === m.sheet) : grid.sheets[0];
  if (!sheet) throw new ParseError("Lembar yang dipilih tidak ada di file.");
  const width = Math.min(MAX_COLUMNS, Math.max(0, ...sheet.rows.map((r) => r.length)));
  const col = (c: unknown) => Number.isInteger(c) && (c as number) >= 0 && (c as number) < width;
  if (!Number.isInteger(m.firstRow) || m.firstRow < 1 || m.firstRow > sheet.rows.length) throw new ParseError("Pilih baris transaksi pertama.");
  if (!col(m.date)) throw new ParseError("Pilih kolom Tanggal.");
  if (!Array.isArray(m.description) || !m.description.length || !m.description.every(col)) throw new ParseError("Pilih kolom Keterangan.");
  if (!col(m.balance)) throw new ParseError("Pilih kolom Saldo: setiap baris dibuktikan oleh saldo berjalan.");
  const money = m.amount?.style === "split" ? [m.amount.debit, m.amount.credit] : m.amount?.style === "signed" ? [m.amount.column, ...(m.amount.direction === null ? [] : [m.amount.direction])] : null;
  if (!money) throw new ParseError("Pilih kolom nominal: Debet dan Kredit, atau Jumlah.");
  if (m.amount.style === "split" && !(col(m.amount.debit) && col(m.amount.credit))) throw new ParseError("Pilih kolom Debet dan kolom Kredit.");
  if (!money.every(col)) throw new ParseError("Pilih kolom Jumlah.");
  const used = [m.date, ...m.description, ...money, m.balance];
  if (new Set(used).size !== used.length) throw new ParseError("Satu kolom hanya boleh punya satu peran.");
  if (m.order !== "DMY" && m.order !== "MDY") throw new ParseError("Pilih urutan tanggal.");
  if (m.year !== undefined && m.year !== null && !(Number.isInteger(m.year) && m.year >= 2000 && m.year <= 2100)) throw new ParseError("Tahun harus 4 angka, misalnya 2026.");
  return sheet;
}

/** The header row of a mapping: the row above the first transaction row, when it names columns in words. */
export function headerOf(sheet: GridSheet, firstRow: number): string[] | null {
  const row = sheet.rows[firstRow - 2];
  return row && row.filter((c) => /\p{L}{2,}/u.test(c)).length >= 3 ? row : null;
}

/** The fingerprint a mapping is remembered under (null when the file has no header row: a data row is no fingerprint). */
export function signatureOf(grid: Grid, m: ColumnMapping): string | null {
  const sheet = checkMapping(m, grid);
  const header = headerOf(sheet, m.firstRow);
  return header ? layoutSignature(grid.kind, header) : null;
}

/** An amount cell: its unsigned text and the direction it states, or null when the cell is empty; "abc" is refused with the row. */
function amountCell(text: string | undefined, row: number, what: string): { value: bigint; flag: "DB" | "CR" | null } | null {
  const t = (text ?? "").trim();
  if (!t || t === "-") return null;
  const { text: bare, flag } = splitMarker(t);
  if (!/\d/.test(bare) || /\p{L}{2,}/u.test(bare.replace(/Rp\.?|IDR/gi, ""))) throw new ParseError(`Baris ${row}: kolom ${what} berisi "${t}", bukan angka. Periksa pemetaan kolomnya.`);
  try {
    return { value: parseBankAmount(bare), flag };
  } catch (error) {
    if (error instanceof SourceAmountError) throw error;
    throw new ParseError(`Baris ${row}: kolom ${what} berisi "${t}", bukan angka. Periksa pemetaan kolomnya.`);
  }
}

/** A direction column's word: out (D, DB, DR, Debet, Debit, Keluar), in (K, C, CR, Kredit, Credit, Masuk), or null. */
function directionOf(text: string | undefined): "DB" | "CR" | null {
  const t = (text ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (/^(d|db|dr|debet|debit|keluar|out|-)$/.test(t)) return "DB";
  if (/^(k|c|cr|kr|kredit|credit|masuk|in|\+)$/.test(t)) return "CR";
  return null;
}

/** The signed movement of a row (+ in, − out), or null when its amount cells are empty. */
function movementOf(cells: string[], a: AmountMapping, row: number): bigint | null {
  if (a.style === "split") {
    assertSingleSide(cells[a.debit], cells[a.credit], row);
    const d = amountCell(cells[a.debit], row, "Debet");
    const c = amountCell(cells[a.credit], row, "Kredit");
    if (!d && !c) return null;
    const abs = (v: bigint) => (v < 0n ? -v : v);
    return (c ? abs(c.value) : 0n) - (d ? abs(d.value) : 0n);
  }
  const v = amountCell(cells[a.column], row, "Jumlah");
  if (!v) return null;
  const abs = v.value < 0n ? -v.value : v.value;
  const dir = (a.direction === null ? null : directionOf(cells[a.direction])) ?? v.flag;
  return dir === "DB" ? -abs : dir === "CR" ? abs : v.value;
}

/** Day/month order of the date column, from its values: one that can only be day-first or month-first decides, else the order that runs in time. */
export function guessOrder(sheet: GridSheet, firstRow: number, date: number): DayMonthOrder {
  const texts = sheet.rows.slice(firstRow - 1).map((r) => r[date] ?? "").filter(Boolean);
  const ev = dayMonthEvidence(texts);
  if (ev.dmy && !ev.mdy) return "DMY";
  if (ev.mdy && !ev.dmy) return "MDY";
  return chronologicalOrder(ev.numeric) ?? "DMY";
}

const OPENING_ROW = /saldo\s*awal|opening\s*balance|beginning\s*balance|saldo\s*sebelumnya|previous\s*balance|starting\s*balance/i;

/**
 * The statement a mapping reads: transaction rows (a date and an amount), the opening from a "Saldo awal" row or from the first balance,
 * descriptions continued on dateless rows below a transaction, newest-first files turned oldest-first. Rows that are neither (page
 * headers, totals, footers) are skipped and counted in a note.
 */
export function readMapped(grid: Grid, m: ColumnMapping, ctx: { fileName?: string } = {}): ParsedStatement {
  return readMappedDetail(grid, m, ctx).statement;
}

/** `readMapped` and whether its opening was printed (a "Saldo awal" row) rather than derived from the first balance and its movement. */
export function readMappedDetail(grid: Grid, m: ColumnMapping, ctx: { fileName?: string } = {}): { statement: ParsedStatement; printedOpening: boolean } {
  const sheet = checkMapping(m, grid);
  const header = headerOf(sheet, m.firstRow);
  const moneyColumns = [...(m.amount.style === "split" ? [m.amount.debit, m.amount.credit] : [m.amount.column]), m.balance];
  const sourceRows = sheet.rows.slice(m.firstRow - 1);
  // A mapping can assign custom column names. Those mapped money headers still declare their units.
  const currency = sourceCurrency(
    sheet.rows.slice(0, m.firstRow - 1).map((row) => row.join(" ")),
    [...(header ?? []), ...moneyColumns.map((column) => `Amount ${header?.[column] ?? ""}`)],
    sourceRows.flatMap((row) => moneyColumns.map((column) => row[column] ?? "")),
    sourceRows,
  );
  const isXlsx = grid.kind === "XLSX";
  const rows: ParsedRow[] = [];
  let printedOpening: bigint | null = null;
  let skipped = 0;
  let year = m.year ?? null;
  let lastMonth = 0;
  for (let i = m.firstRow - 1; i < sheet.rows.length; i++) {
    const cells = sheet.rows[i];
    const n = i + 1;
    if (!cells.some(Boolean)) continue;
    if (header && sameRow(cells, header)) continue;
    const dateText = cells[m.date] ?? "";
    const p = dateText ? dateParts(dateText, { serial: isXlsx, order: m.order }) : null;
    const description = m.description.map((c) => cells[c] ?? "").filter(Boolean).join(" ");
    if (!p) {
      // A dateless row with text only in the description columns continues the transaction above it.
      const others = cells.some((c, k) => c && !m.description.includes(k));
      if (rows.length && description && !others) rows[rows.length - 1].description += ` ${description}`;
      else skipped++;
      continue;
    }
    const movement = movementOf(cells, m.amount, n);
    const balanceCell = amountCell(cells[m.balance], n, "Saldo");
    const balance = balanceCell ? (balanceCell.flag === "DB" ? -(balanceCell.value < 0n ? -balanceCell.value : balanceCell.value) : balanceCell.value) : null;
    if (movement === null || movement === 0n) {
      if (OPENING_ROW.test(description) && balance !== null && !rows.length) printedOpening = balance;
      else skipped++;
      continue;
    }
    if (p.y === null) {
      if (year === null) throw new YearNeededError(guessYear(ctx.fileName));
      // Dates without a year run on through December into January.
      if (lastMonth === 12 && p.m === 1) year++;
    }
    lastMonth = p.m;
    const y = p.y ?? year!;
    const date = dateOnly(y, p.m, p.d);
    if (date.getUTCMonth() + 1 !== p.m) throw new ParseError(`Baris ${n}: tanggal "${dateText}" tidak ada di kalender. Periksa urutan tanggal (hari/bulan).`);
    if (y < 2000 || y > 2100) throw new ParseError(`Baris ${n}: tanggal "${dateText}" tidak masuk akal. Periksa kolom tanggal.`);
    rows.push({ date, description: description || "(tanpa keterangan)", amount: movement, balance, rowNumber: n, rawRow: cells.join(" | "), ...(isXlsx ? { sheet: sheet.name } : {}) });
  }
  if (!rows.length) throw new ParseError("Tidak ada baris transaksi dengan pemetaan ini. Periksa baris pertama dan kolom tanggal serta nominalnya.");
  if (+rows[0].date > +rows[rows.length - 1].date) rows.reverse();
  const LIMIT = 10n ** 15n;
  const huge = rows.find((r) => r.amount > LIMIT || r.amount < -LIMIT || (r.balance !== null && (r.balance > LIMIT || r.balance < -LIMIT)));
  if (huge) throw new ParseError(`Nominal terlalu besar di baris ${huge.rowNumber} (maks. 15 angka). Periksa kolom nominal dan saldo.`);
  const opening = printedOpening ?? openingFromBalances(rows);
  if (opening === null) throw new ParseError("Kolom Saldo kosong di semua baris. Pilih kolom saldo yang benar.");
  const { start, end } = monthBoundsOf(rows);
  const preamble = sheet.rows.slice(0, m.firstRow - 1).map((r) => r.join(" ")).join("\n");
  const notes = skipped ? [`${skipped} baris tanpa tanggal atau tanpa nominal dilewati (judul halaman, total, catatan).`] : [];
  return {
    statement: { format: detectBank(preamble), currency, accountNumber: null, periodStart: start, periodEnd: end, openingBalance: opening, closingBalance: closingFromRows(rows, opening), rows, notes },
    printedOpening: printedOpening !== null,
  };
}

/**
 * A first guess at the mapping, for the accountant to correct: the date column is the one with most dates, the first transaction row the
 * first with a date there and a number elsewhere, the balance the right-most number column, the amounts the number columns before it,
 * every other column with text joined as the description. Never applied without the accountant's click.
 */
export function suggestMapping(grid: Grid, sheetName?: string | null): ColumnMapping {
  const sheet = (grid.kind === "XLSX" && sheetName ? grid.sheets.find((s) => s.name === sheetName) : null) ?? grid.sheets[0];
  const isXlsx = grid.kind === "XLSX";
  const width = Math.min(MAX_COLUMNS, Math.max(1, ...sheet.rows.map((r) => r.length)));
  const isDate = (t: string | undefined) => !!t && !!dateParts(t, { serial: isXlsx });
  // A number: digits and amount punctuation once a marker and "Rp"/"IDR" are off — and not a written date ("01-05-2026"). An Excel serial
  // (45678) is a number here: in an amount column it is one.
  const isNum = (t: string | undefined) => {
    if (!t || dateParts(t)) return false;
    const bare = splitMarker(t).text.replace(/Rp\.?|IDR/gi, "");
    return /\d/.test(bare) && /^[\s\d.,()+-]+$/.test(bare);
  };
  const count = (f: (t: string | undefined) => boolean) => Array.from({ length: width }, (_, c) => sheet.rows.filter((r) => f(r[c])).length);
  const dates = count(isDate);
  const date = dates.indexOf(Math.max(...dates));
  const firstIdx = Math.max(0, sheet.rows.findIndex((r) => isDate(r[date]) && r.some((c, k) => k !== date && isNum(c))));
  const body = sheet.rows.slice(firstIdx).filter((r) => isDate(r[date]));
  const nums = Array.from({ length: width }, (_, c) => body.filter((r) => isNum(r[c])).length);
  // Debet and Kredit each fill only some rows: a column counts as numbers when a tenth of the rows hold one and no row holds words there.
  const words = Array.from({ length: width }, (_, c) => body.filter((r) => r[c] && !isNum(r[c])).length);
  const numCols = nums.map((v, c) => (c !== date && v >= Math.max(1, body.length * 0.1) && words[c] <= body.length * 0.1 ? c : -1)).filter((c) => c >= 0);
  const balance = numCols.length ? numCols[numCols.length - 1] : Math.min(width - 1, date + 2);
  const money = numCols.filter((c) => c !== balance).slice(-2);
  // A column holding only direction words (D/K, DB/CR) on every transaction row.
  const direction = Array.from({ length: width }, (_, c) => c).find((c) => c !== date && !numCols.includes(c) && body.length > 0 && body.every((r) => directionOf(r[c]) !== null)) ?? null;
  // Every other column with text on a transaction row is part of the description (banks split it: type, reference, counterparty).
  const description = Array.from({ length: width }, (_, c) => c).filter(
    (c) => c !== date && c !== direction && !numCols.includes(c) && body.some((r) => r[c]) && body.filter((r) => isDate(r[c])).length <= body.length / 2,
  );
  const amount: AmountMapping =
    money.length === 2 && direction === null ? { style: "split", debit: money[0], credit: money[1] } : { style: "signed", column: money[money.length - 1] ?? Math.max(0, balance - 1), direction };
  const firstRow = firstIdx + 1;
  return { sheet: isXlsx ? sheet.name : null, firstRow, date, description: description.length ? description : [Math.min(width - 1, date + 1)], amount, balance, order: guessOrder(sheet, firstRow, date), year: null };
}

/** A layout the firm mapped before (`StatementLayout`): the mapping less sheet, first row and year, under its header's signature. */
export type RememberedLayout = { id: string; label: string; signature: string; mapping: Omit<ColumnMapping, "sheet" | "firstRow" | "year"> };

/** How far down a sheet a header is looked for (title blocks above it vary from month to month). */
const HEADER_SEARCH_ROWS = 80;

/**
 * The file read with the first remembered layout whose header it carries (any sheet, any row in the first 80) and whose day/month order
 * its dates don't contradict, or null when there is none. The caller passes only the layouts of the account's bank. A matching header with rows the mapping can't read is refused with the reader's message: the accountant maps the file again.
 */
export function readWithLayout(grid: Grid, layouts: RememberedLayout[], ctx: { fileName?: string; year?: number } = {}): ParsedStatement | null {
  for (const sheet of grid.sheets) {
    for (let i = 0; i < Math.min(sheet.rows.length - 1, HEADER_SEARCH_ROWS); i++) {
      const sig = layoutSignature(grid.kind, sheet.rows[i]);
      const layout = sig && layouts.find((l) => l.signature === sig);
      if (!layout) continue;
      const mapping: ColumnMapping = { ...layout.mapping, sheet: grid.kind === "XLSX" ? sheet.name : null, firstRow: i + 2, year: ctx.year ?? null };
      // A file whose own dates prove the other day/month order is another export that happens to share the header: not this layout.
      const ev = dayMonthEvidence(sheet.rows.slice(i + 1).map((r) => r[mapping.date] ?? "").filter(Boolean));
      if ((mapping.order === "DMY" && ev.mdy && !ev.dmy) || (mapping.order === "MDY" && ev.dmy && !ev.mdy)) continue;
      let st: ParsedStatement;
      try {
        st = readMapped(grid, mapping, ctx);
      } catch (e) {
        // Still a file the accountant can map again (the new mapping replaces this one on import).
        if (e instanceof ParseError && !(e instanceof YearNeededError) && !(e instanceof SourceCurrencyError) && !(e instanceof SourceAmountError) && !(e instanceof SourceDateError)) throw new UnreadableFileError(`File ini cocok dengan pemetaan kolom tersimpan ("${layout.label}"), tetapi tidak terbaca: ${e.message}`);
        throw e;
      }
      return { ...st, layout: { id: layout.id, label: layout.label }, notes: [`Dibaca dengan pemetaan kolom tersimpan (dari "${layout.label}").`, ...(st.notes ?? [])] };
    }
  }
  return null;
}

