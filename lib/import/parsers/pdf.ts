import { extractTextItems, getDocumentProxy } from "unpdf";
import type { BankCode } from "@/lib/generated/prisma/enums";
import { dateOnly } from "@/lib/format";
import { parseRupiah } from "@/lib/money";
import { ParseError, type DepositProduct, type ParsedRow, type ParsedStatement } from "@/lib/import/types";
import { closingFromRows, dateParts, MONTHS, monthBoundsOf, periodFromText, SenWatch } from "@/lib/import/parsers/common";

/**
 * Text PDF e-statements (BCA / Mandiri / BRI and similar layouts). No AI: text + positions → table rows,
 * and correctness is proven by the running-balance continuity check downstream (accounting-rules §12).
 *
 * Layout model: one header line names the columns (tanggal · keterangan · debet/kredit or mutasi · saldo).
 * Rows start with a date in the date column. Lines without a date directly below a row continue its description.
 * Numbers are assigned to the nearest amount/balance header by x, so reference numbers inside the description
 * never become amounts.
 */

export class PdfPasswordError extends ParseError {
  constructor(readonly reason: "needed" | "wrong") {
    super(reason === "needed" ? "PDF ini dikunci kata sandi. Masukkan kata sandinya untuk membuka." : "Kata sandi PDF salah. Coba lagi.");
  }
}

type Cell = { x0: number; x1: number; text: string };
export type Line = { page: number; y: number; cells: Cell[] };
type ColKind = "date" | "desc" | "debit" | "credit" | "amount" | "balance" | "flag";
type Column = { kind: ColKind; x0: number; x1: number };

const HEADER: Record<ColKind, RegExp> = {
  date: /^(tanggal|tgl\.?|date|tanggal transaksi|post(ing)? date|tgl\.? transaksi|trans(action)? date)$/i,
  desc: /^(keterangan|uraian|uraian transaksi|deskripsi|description|remark|remarks|transaction description|transaction desc|narasi|berita)$/i,
  debit: /^(debet|debit|mutasi debet|mutasi debit|(uang )?keluar|withdrawal|pengeluaran)$/i,
  credit: /^(kredit|credit|mutasi kredit|(uang )?masuk|deposit|pemasukan)$/i,
  amount: /^(mutasi|jumlah|nominal|amount)$/i,
  balance: /^(saldo|balance|saldo akhir)$/i,
  flag: /^(db\/cr|d\/k|dk|cr\/db)$/i,
};
/** An amount: optional sign and "Rp"/"IDR" before it ("+1.000.000", "-Rp 2.500", "(2.500)"), a DB/CR marker after. */
const NUMBER = /^[+-]?\s*(?:(?:Rp\.?|IDR)\s*)?\(?[+-]?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?\)?(?:\s*(DB|CR|DR|D|K|C))?$/i;
/** Digits with amount punctuation (a separator, sign, brackets or "Rp") and no word: what a damaged amount looks like. A bare "0998" is a code. */
const looksLikeAmount = (t: string) => /\d/.test(t) && /[.,+()-]|^(?:Rp|IDR)/i.test(t) && !/[A-Za-z]{3,}/.test(t.replace(/^(?:Rp\.?|IDR)/i, ""));
/** "Aktivitas Rekening / Account Activities – <name> (<CCY>) <number>" — any separator after the last title word. */
const SECTION = /.*(?:account activities|aktivitas rekening)[^\p{L}\p{N}]+(.+?)\s*\(([A-Za-z]{3})\)\s*([0-9A-Za-z]{6,})\s*$/iu;
const OPENING = /saldo\s*awal|opening\s*balance|beginning\s*balance|saldo\s*sebelumnya/i;
const CLOSING = /saldo\s*akhir|closing\s*balance|ending\s*balance/i;
const FOOTER = /^(saldo\s*awal|saldo\s*akhir|mutasi\s*(cr|db|kredit|debet)|total|jumlah|bersambung|halaman|page|opening|closing|ending)\b/i;

export async function parsePdf(data: Buffer, opts: { password?: string } = {}): Promise<ParsedStatement> {
  return (await parsePdfSections(data, opts))[0];
}

/**
 * Combined statements (e.g. SMBC "Laporan Konsolidasi Rekening") hold several accounts, each under a header like
 * "Aktivitas Rekening / Account Activities – Jenius Main Account (IDR) 90022152088". Each section is parsed and
 * continuity-checked on its own; single-account PDFs return one statement.
 */
export async function parsePdfSections(data: Buffer, opts: { password?: string } = {}): Promise<ParsedStatement[]> {
  const lines = await readLines(data, opts.password);
  if (lines.reduce((n, l) => n + l.cells.reduce((m, c) => m + c.text.replace(/\s/g, "").length, 0), 0) < 20) {
    throw new ParseError("PDF ini hasil scan (tanpa teks). Minta rekening koran versi e-statement, atau ekspor CSV/Excel dari internet banking.");
  }
  const deposits = depositProducts(lines);
  const withDeposits = (st: ParsedStatement): ParsedStatement => (deposits.length ? { ...st, deposits } : st);
  const starts = lines.map((l, i) => ({ i, m: lineText(l).match(SECTION) })).filter((x) => x.m);
  if (starts.length === 0) return [withDeposits(parseLines(lines))];
  const docText = lines.map(lineText).join("\n");
  const format = detectFormat(docText);
  const period = periodOf(docText);
  const out: ParsedStatement[] = [];
  starts.forEach(({ i, m }, k) => {
    const segment = lines.slice(i + 1, k + 1 < starts.length ? starts[k + 1].i : lines.length);
    if (!segment.some((l) => headerColumns(l))) return; // a section title without a transaction table
    const st = parseLines(segment, { period, format, allowEmpty: true });
    out.push(withDeposits({ ...st, accountNumber: m![3], section: { label: m![1].trim(), currency: m![2].toUpperCase() } }));
  });
  if (!out.length) return [withDeposits(parseLines(lines))];
  return out;
}

const DEPOSIT_TITLE = /detail produk deposito|time deposit product details/i;
const DEPOSIT_END = /^(total\b|detail produk|ini adalah akhir)/i;

/**
 * Time deposits listed after the account activity (SMBC "Detail Produk Deposito / Time Deposit Product Details"): one row per
 * deposit — number, product, currency, rate, tenor, maturity, instruction, balance, IDR equivalent. Read so Saldo Awal can
 * offer them (a deposit pledged for a PRK is the other half of that loan); never posted from here.
 */
export function depositProducts(lines: Line[]): DepositProduct[] {
  const out: DepositProduct[] = [];
  const start = lines.findIndex((l) => DEPOSIT_TITLE.test(lineText(l)));
  if (start < 0) return out;
  for (const line of lines.slice(start + 1)) {
    const text = lineText(line).trim();
    if (DEPOSIT_END.test(text)) break;
    const cells = line.cells.map((c) => c.text.trim());
    const number = cells[0];
    const currency = cells.find((c) => /^[A-Z]{3}$/.test(c));
    const amounts = cells.filter((c) => /^-?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?$/.test(c));
    if (!number || !/\d/.test(number) || !/^[0-9A-Z]{6,}$/i.test(number) || !currency || amounts.length === 0) continue;
    const maturity = cells.map((c) => parseDate(c, null)).find(Boolean) ?? null;
    out.push({
      number,
      product: cells[1] && !/^[A-Z]{3}$/.test(cells[1]) ? cells[1] : "Deposito",
      currency,
      rate: cells.find((c) => /^\d+(?:[.,]\d+)?\s*%$/.test(c))?.replace(/\s/g, "") ?? null,
      maturity: maturity ? maturity.toISOString().slice(0, 10) : null,
      idrBalance: parseRupiah(amounts[amounts.length - 1]),
    });
  }
  return out;
}

/** Positioned text lines. Exported for `npm run inspect:statement -- --lines` when tuning a new layout. */
export type ReadLinesLimits = { maxPages?: number; maxItems?: number };
type PositionedItem = { str: string; x: number; y: number; width: number; fontSize: number };

/** Bounded evidence reads do not allocate text for all pages concurrently. */
async function boundedTextItems(doc: Awaited<ReturnType<typeof getDocumentProxy>>, maxItems: number): Promise<PositionedItem[][]> {
  const pages: PositionedItem[][] = [];
  let count = 0;
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    const reader = page.streamTextContent().getReader() as ReadableStreamDefaultReader<Awaited<ReturnType<typeof page.getTextContent>>>;
    const items: PositionedItem[] = [];
    let overLimit = false;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        for (const item of chunk.value.items) {
          if (!("str" in item)) continue;
          if (++count > maxItems) { overLimit = true; continue; }
          // Keep the same positioned-text normalization as unpdf.extractTextItems.
          const [, , c, d, x, y] = item.transform;
          items.push({ str: item.str, x, y, width: item.width, fontSize: Math.hypot(c, d) });
        }
      }
      // Drain the active page without retaining excess items. Cancelling an active
      // PDF.js stream can race its close message; no later page is requested.
      if (overLimit) throw new ParseError(`Teks PDF melebihi batas ${maxItems.toLocaleString("id-ID")} bagian. Pecah PDF menjadi beberapa file lalu unggah kembali.`);
      pages.push(items);
    } finally {
      reader.releaseLock();
      page.cleanup();
    }
  }
  return pages;
}

export async function readLines(data: Buffer, password?: string, limits: ReadLinesLimits = {}): Promise<Line[]> {
  for (const value of [limits.maxPages, limits.maxItems]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw new ParseError("Batas ekstraksi PDF tidak valid.");
  }
  let doc;
  try {
    doc = await getDocumentProxy(new Uint8Array(data), { password: password || undefined });
  } catch (e) {
    const err = e as { name?: string; code?: number; message?: string };
    if (err.name === "PasswordException") throw new PdfPasswordError(err.code === 2 ? "wrong" : "needed");
    throw new ParseError("File PDF rusak atau tidak bisa dibuka.");
  }
  try {
    if (limits.maxPages !== undefined && doc.numPages > limits.maxPages) throw new ParseError(`PDF melebihi batas ${limits.maxPages} halaman. Pecah PDF menjadi beberapa file lalu unggah kembali.`);
    const items = limits.maxItems === undefined ? (await extractTextItems(doc)).items : await boundedTextItems(doc, limits.maxItems);
    const out: Line[] = [];
    items.forEach((pageItems, p) => {
      const rows: { y: number; parts: { x: number; w: number; s: string; size: number }[] }[] = [];
      for (const it of pageItems) {
        if (!it.str.trim()) continue;
        const tol = Math.max(2, it.fontSize * 0.35);
        let row = rows.find((r) => Math.abs(r.y - it.y) <= tol);
        if (!row) rows.push((row = { y: it.y, parts: [] }));
        row.parts.push({ x: it.x, w: it.width, s: it.str, size: it.fontSize || 8 });
      }
      rows.sort((a, b) => b.y - a.y); // PDF y grows upwards → top of page first
      for (const r of rows) {
        r.parts.sort((a, b) => a.x - b.x);
        const cells: Cell[] = [];
        for (const part of r.parts) {
          const last = cells[cells.length - 1];
          const gap = last ? part.x - last.x1 : Infinity;
          if (last && gap < part.size * 0.9) {
            last.text += (gap > part.size * 0.15 ? " " : "") + part.s.trim();
            last.x1 = part.x + part.w;
          } else cells.push({ x0: part.x, x1: part.x + part.w, text: part.s.trim() });
        }
        out.push({ page: p + 1, y: r.y, cells });
      }
    });
    return out;
  } finally {
    // unpdf retains caller-owned proxies; release workers and cached page data on every exit.
    await doc.loadingTask.destroy();
  }
}

const lineText = (l: Line) => l.cells.map((c) => c.text).join(" ");

function headerColumns(line: Line): Column[] | null {
  const cols: Column[] = [];
  for (const c of line.cells) {
    // "Debit (IDR)": the currency in brackets after a label isn't part of it.
    const t = c.text.replace(/\s+/g, " ").replace(/\s*\((?:idr|rp\.?|rupiah|[a-z]{3})\)$/i, "").trim();
    const kind = (Object.keys(HEADER) as ColKind[]).find((k) => HEADER[k].test(t));
    if (kind) cols.push({ kind, x0: c.x0, x1: c.x1 });
  }
  const has = (k: ColKind) => cols.some((c) => c.kind === k);
  const hasMoney = (has("debit") && has("credit")) || has("amount");
  return has("date") && has("desc") && hasMoney ? cols : null;
}

function nearest(cols: Column[], cell: Cell, kinds: ColKind[]): Column | null {
  const mid = (cell.x0 + cell.x1) / 2;
  let best: Column | null = null;
  let bestD = Infinity;
  for (const c of cols) {
    const d = Math.abs((c.x0 + c.x1) / 2 - mid);
    if (d < bestD) [best, bestD] = [c, d];
  }
  return best && kinds.includes(best.kind) ? best : null;
}

function detectFormat(headerText: string): BankCode {
  // BCA e-statements print their notes letter-spaced ("B C A b e r h a k …"), which loses the word breaks: collapsed, the
  // capitals "BCA" still stand apart from the lowercase text around them.
  const collapsed = headerText.replace(/(\p{L}) (?=\p{L}(?: |$))/gmu, "$1");
  if (/\bSMBC\b|bank smbc indonesia|jenius|\bBTPN\b/i.test(headerText)) return "SMBC";
  if (/mandiri/i.test(headerText)) return "MANDIRI";
  if (/\bBRI\b|bank rakyat/i.test(headerText)) return "BRI";
  if (/\bBCA\b|bank central asia|klikbca/i.test(headerText) || /(?<![A-Z])BCA(?![A-Z])/.test(collapsed)) return "BCA";
  return "GENERIC";
}

export function periodOf(text: string): { start: Date; end: Date } | null {
  const range = periodFromText(text);
  if (range) return range;
  // "01 MEI 2026 - 31 MEI 2026" (SMBC and others print month names)
  const long = text.match(/(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s*[-–]\s*(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/);
  if (long) {
    const a = parseDate(long[1], null);
    const b = parseDate(long[2], null);
    if (a && b) return { start: a, end: b };
  }
  const m = text.match(/periode\s*:?\s*([A-Za-z]+)\s+(\d{4})/i);
  const month = m && MONTHS[m[1].toLowerCase()];
  if (!m || !month) return null;
  const y = Number(m[2]);
  return { start: dateOnly(y, month, 1), end: new Date(Date.UTC(y, month, 0)) };
}

function parseDate(text: string, period: { start: Date; end: Date } | null): Date | null {
  const p = dateParts(text);
  if (!p) return null;
  let y = p.y;
  if (y === null) {
    if (!period) return null;
    y = period.start.getUTCFullYear();
    if (p.m < period.start.getUTCMonth() + 1 && period.end.getUTCFullYear() > y) y++; // Dec → Jan statements
  }
  const date = dateOnly(y, p.m, p.d);
  return date.getUTCMonth() + 1 === p.m ? date : null; // 31 Feb is no date
}

/** Points between a lead-in description line and the amount line below it (SMBC prints ~3 pt; rows are ≥ 9 pt apart). */
const LEAD_GAP = 5;

function startsWithDate(line: Line, descCol: Column, period: { start: Date; end: Date } | null): boolean {
  const first = line.cells[0];
  if (!first || first.x0 >= descCol.x0 - 1) return false;
  const tokens = first.text.split(/\s+/);
  return Boolean(parseDate(tokens.slice(0, 3).join(" "), period) ?? parseDate(tokens[0], period));
}

function money(text: string): { value: bigint; flag: "DB" | "CR" | null } {
  const m = text.trim().match(NUMBER)!;
  const f = m[1]?.toUpperCase();
  const flag = f ? (["DB", "DR", "D"].includes(f) ? "DB" : "CR") : null;
  return { value: parseRupiah(text.replace(/\s*(DB|CR|DR|D|K|C)$/i, "")), flag };
}

function parseLines(lines: Line[], ctx: { period?: { start: Date; end: Date } | null; format?: BankCode; allowEmpty?: boolean } = {}): ParsedStatement {
  const firstHeader = lines.findIndex((l) => headerColumns(l));
  if (firstHeader < 0) {
    throw new ParseError("Tabel transaksi di PDF tidak dikenali (kolom tanggal, keterangan, mutasi/debet-kredit tidak ditemukan). Kirim contoh baris judulnya agar formatnya bisa ditambahkan.");
  }
  const preamble = lines.slice(0, firstHeader).map(lineText).join("\n");
  const allText = lines.map(lineText).join("\n");
  const period = ctx.period ?? periodOf(preamble) ?? periodOf(allText);
  const accountNumber =
    preamble
      .split("\n")
      .filter((t) => /(no\.?\s*rek|nomor rekening|rekening|account)/i.test(t))
      .map((t) => t.match(/\d[\d-]{5,}\d/)?.[0])
      .find(Boolean)
      ?.replace(/-/g, "") ?? null;

  const sen = new SenWatch();
  type Draft = ParsedRow & { flag: "DB" | "CR" | null; parts: string[]; page: number; lastY: number; moneySeen: boolean; unreadable: string | null };
  const drafts: Draft[] = [];
  let cols: Column[] | null = null;
  let current: Draft | null = null;
  let opening: bigint | null = null;
  let closing: bigint | null = null;
  let lineNo = 0;
  // Description text printed just above a row's amount line (SMBC centres a two-line description on it): held for that row.
  let lead: string[] = [];

  for (const [index, line] of lines.entries()) {
    lineNo++;
    const header = headerColumns(line);
    if (header) {
      cols = header;
      current = null;
      lead = [];
      continue;
    }
    const text = lineText(line);
    const labelled = text.match(/(saldo\s*awal|opening\s*balance|beginning\s*balance|saldo\s*akhir|closing\s*balance|ending\s*balance)\s*:?\s*(?:rp\.?\s*)?([\d.,()-]+)/i);
    if (labelled && !(cols && parseDate(line.cells[0]?.text ?? "", period))) {
      const v = parseRupiah(labelled[2]);
      if (OPENING.test(labelled[1])) opening ??= v;
      else if (CLOSING.test(labelled[1])) closing = v;
      current = null;
      continue;
    }
    if (!cols) continue;

    const dateCol = cols.find((c) => c.kind === "date")!;
    const descCol = cols.find((c) => c.kind === "desc")!;
    const moneyKinds: ColKind[] = ["debit", "credit", "amount", "balance"];
    const cells = [...line.cells];
    let date: Date | null = null;
    const first = cells[0];
    if (first && first.x0 < descCol.x0 - 1) {
      // The date may share a cell with a time or the start of the description ("06/08/2026 10:21 TRSF …").
      const tokens = first.text.split(/\s+/);
      const long = parseDate(tokens.slice(0, 3).join(" "), period);
      date = long ?? parseDate(tokens[0], period);
      if (date) {
        const tail = tokens.slice(long ? 3 : 1).join(" ").replace(/^\d{1,2}[:.]\d{2}(?::\d{2})?\s*/, "");
        cells[0] = { ...first, text: tail };
        if (!tail) cells.shift();
      }
    }

    const descParts: string[] = [];
    const nums: { kind: ColKind; value: bigint; flag: "DB" | "CR" | null }[] = [];
    let flag: "DB" | "CR" | null = null;
    // A figure under an amount column that isn't a readable number ("45.6x8,00"): remembered so its row can't become a silent 0.
    let unreadable: string | null = null;
    for (const c of cells) {
      if (NUMBER.test(c.text) && c.x0 > descCol.x0) {
        const col = nearest(cols, c, moneyKinds);
        if (col) {
          sen.check(c.text, lineNo);
          nums.push({ kind: col.kind, ...money(c.text) });
          continue;
        }
      }
      if (/^(DB|CR|DR|D|K)$/i.test(c.text) && c.x0 > descCol.x1) {
        flag = /^(DB|DR|D)$/i.test(c.text) ? "DB" : "CR";
        continue;
      }
      if (c.x0 > descCol.x0 && looksLikeAmount(c.text) && nearest(cols, c, moneyKinds)) unreadable ??= c.text;
      if (c.x0 >= dateCol.x1 - 1 || date) descParts.push(c.text);
    }

    if (date) {
      // A second date column (posting date, "Tanggal Pembukuan") isn't part of the description.
      if (descParts.length && parseDate(descParts[0], period)) descParts.shift();
      const desc = [...lead, ...descParts].join(" ").replace(/\s+/g, " ").trim();
      const leadRaw = lead.length ? `${lead.join(" / ")} / ` : "";
      lead = [];
      const bal = nums.find((n) => n.kind === "balance");
      if (OPENING.test(desc) && nums.every((n) => n.kind === "balance")) {
        if (bal) opening ??= bal.value;
        current = null;
        continue;
      }
      const dr = nums.find((n) => n.kind === "debit")?.value ?? 0n;
      const cr = nums.find((n) => n.kind === "credit")?.value ?? 0n;
      const amt = nums.find((n) => n.kind === "amount");
      current = {
        date,
        description: desc,
        amount: amt ? amt.value : cr - dr,
        balance: bal?.value ?? null,
        rowNumber: lineNo,
        rawRow: `hal. ${line.page} · ${leadRaw}${line.cells.map((c) => c.text).join(" | ")}`,
        flag: amt?.flag ?? flag,
        parts: [desc],
        page: line.page,
        lastY: line.y,
        moneySeen: nums.some((n) => n.kind !== "balance"),
        unreadable,
      };
      if (!amt && dr === 0n && cr === 0n) current.amount = 0n;
      drafts.push(current);
      continue;
    }

    // A text line sitting just above the next row's amounts, nearer to it than to the current row, starts that row's description.
    const next = lines[index + 1];
    if (descParts.length && !nums.length && next && next.page === line.page && !FOOTER.test(text) && startsWithDate(next, descCol, period)) {
      const gap = line.y - next.y;
      if (gap >= 0 && gap <= LEAD_GAP && (!current || current.page !== line.page || current.lastY - line.y > gap)) {
        lead.push(descParts.join(" "));
        continue;
      }
    }

    // Continuation of the previous row's description (same page, close below, not a footer).
    if (current && line.page === current.page && current.lastY - line.y < 30 && !FOOTER.test(text) && descParts.length) {
      current.parts.push(descParts.join(" "));
      current.description = current.parts.join(" ").replace(/\s+/g, " ").trim();
      current.rawRow += ` / ${line.cells.map((c) => c.text).join(" | ")}`;
      current.lastY = line.y;
      if (current.amount === 0n && nums.length) {
        const amt = nums.find((n) => n.kind === "amount" || n.kind === "credit" || n.kind === "debit");
        if (amt) current.moneySeen = true;
        if (amt) current.amount = amt.kind === "debit" ? -amt.value : amt.value;
        if (amt?.flag) current.flag = amt.flag;
        current.balance ??= nums.find((n) => n.kind === "balance")?.value ?? null;
      }
    } else current = null;
  }

  for (const d of drafts) {
    if (!d.moneySeen && d.unreadable) {
      throw new ParseError(`Nominal "${d.unreadable}" di halaman ${d.page} tidak bisa dibaca (baris: ${d.description.slice(0, 60) || "tanpa keterangan"}). Ekspor CSV/Excel dari internet banking, atau kirim contoh barisnya.`);
    }
  }
  if (drafts.length === 0 && !(ctx.allowEmpty && opening !== null)) throw new ParseError("Tidak ada baris transaksi yang terbaca dari PDF ini.");

  // Single amount column: sign from the DB/CR marker, else from the balance movement.
  let prevBalance = opening;
  for (const d of drafts) {
    const abs = d.amount < 0n ? -d.amount : d.amount;
    if (d.flag) d.amount = d.flag === "DB" ? -abs : abs;
    else if (d.amount > 0n && d.balance !== null && prevBalance !== null && prevBalance - abs === d.balance) d.amount = -abs;
    if (d.balance !== null) prevBalance = d.balance;
    else if (prevBalance !== null) prevBalance += d.amount;
  }

  const rows: ParsedRow[] = drafts.map(({ date, description, amount, balance, rowNumber, rawRow }) => ({ date, description, amount, balance, rowNumber, rawRow }));
  if (opening === null) {
    const f = rows[0];
    if (!f) throw new ParseError("Tidak ada baris transaksi yang terbaca dari PDF ini.");
    if (f.balance === null) throw new ParseError("Saldo awal tidak ditemukan di PDF (tidak ada SALDO AWAL dan kolom saldo kosong).");
    opening = f.balance - f.amount;
  }
  const bounds = period ?? monthBoundsOf(rows);
  return {
    format: ctx.format ?? detectFormat(preamble),
    accountNumber,
    periodStart: bounds.start,
    periodEnd: bounds.end,
    openingBalance: opening,
    closingBalance: closing ?? closingFromRows(rows, opening),
    rows,
    ...(sen.note() ? { notes: [sen.note()!] } : {}),
  };
}
