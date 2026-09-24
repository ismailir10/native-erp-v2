import { extractTextItems, getDocumentProxy } from "unpdf";
import type { BankCode } from "@/lib/generated/prisma/enums";
import { dateOnly } from "@/lib/format";
import { parseRupiah } from "@/lib/money";
import { ParseError, type ParsedRow, type ParsedStatement } from "@/lib/import/types";
import { closingFromRows, monthBoundsOf, periodFromText } from "@/lib/import/parsers/common";

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
  date: /^(tanggal|tgl\.?|date|tanggal transaksi|posting date|tgl\.? transaksi)$/i,
  desc: /^(keterangan|uraian|uraian transaksi|deskripsi|description|remark|remarks|transaction description)$/i,
  debit: /^(debet|debit|mutasi debet|mutasi debit|keluar|withdrawal)$/i,
  credit: /^(kredit|credit|mutasi kredit|masuk|deposit)$/i,
  amount: /^(mutasi|jumlah|nominal|amount)$/i,
  balance: /^(saldo|balance|saldo akhir)$/i,
  flag: /^(db\/cr|d\/k|dk|cr\/db)$/i,
};
const NUMBER = /^\(?-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?\)?(?:\s*(DB|CR|DR|D|K|C))?$/i;
const DATE = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/;
const DATE_LONG = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/;
const OPENING = /saldo\s*awal|opening\s*balance|beginning\s*balance|saldo\s*sebelumnya/i;
const CLOSING = /saldo\s*akhir|closing\s*balance|ending\s*balance/i;
const FOOTER = /^(saldo\s*awal|saldo\s*akhir|mutasi\s*(cr|db|kredit|debet)|total|jumlah|bersambung|halaman|page|opening|closing|ending)\b/i;
const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mar: 3, maret: 3, march: 3, apr: 4, april: 4,
  mei: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, agu: 8, agt: 8, agus: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, nopember: 11, november: 11,
  des: 12, desember: 12, dec: 12, december: 12,
};

export async function parsePdf(data: Buffer, opts: { password?: string } = {}): Promise<ParsedStatement> {
  const lines = await readLines(data, opts.password);
  if (lines.reduce((n, l) => n + l.cells.reduce((m, c) => m + c.text.replace(/\s/g, "").length, 0), 0) < 20) {
    throw new ParseError("PDF ini hasil scan (tanpa teks). Minta rekening koran versi e-statement, atau ekspor CSV/Excel dari internet banking.");
  }
  return parseLines(lines);
}

/** Positioned text lines. Exported for `npm run inspect:statement -- --lines` when tuning a new layout. */
export async function readLines(data: Buffer, password?: string): Promise<Line[]> {
  let doc;
  try {
    doc = await getDocumentProxy(new Uint8Array(data), { password: password || undefined });
  } catch (e) {
    const err = e as { name?: string; code?: number; message?: string };
    if (err.name === "PasswordException") throw new PdfPasswordError(err.code === 2 ? "wrong" : "needed");
    throw new ParseError("File PDF rusak atau tidak bisa dibuka.");
  }
  const { items } = await extractTextItems(doc);
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
}

const lineText = (l: Line) => l.cells.map((c) => c.text).join(" ");

function headerColumns(line: Line): Column[] | null {
  const cols: Column[] = [];
  for (const c of line.cells) {
    const t = c.text.replace(/\s+/g, " ").trim();
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
  if (/mandiri/i.test(headerText)) return "MANDIRI";
  if (/\bBRI\b|bank rakyat/i.test(headerText)) return "BRI";
  if (/\bBCA\b|bank central asia|klikbca/i.test(headerText)) return "BCA";
  return "GENERIC";
}

function periodOf(text: string): { start: Date; end: Date } | null {
  const range = periodFromText(text);
  if (range) return range;
  const m = text.match(/periode\s*:?\s*([A-Za-z]+)\s+(\d{4})/i);
  const month = m && MONTHS[m[1].toLowerCase()];
  if (!m || !month) return null;
  const y = Number(m[2]);
  return { start: dateOnly(y, month, 1), end: new Date(Date.UTC(y, month, 0)) };
}

function parseDate(text: string, period: { start: Date; end: Date } | null): Date | null {
  let m = text.match(DATE);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    let y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : null;
    if (y === null) {
      if (!period) return null;
      y = period.start.getUTCFullYear();
      if (mo < period.start.getUTCMonth() + 1 && period.end.getUTCFullYear() > y) y++; // Dec → Jan statements
    }
    return dateOnly(y, mo, d);
  }
  m = text.match(DATE_LONG);
  const mo = m && MONTHS[m[2].toLowerCase()];
  return m && mo ? dateOnly(Number(m[3]), mo, Number(m[1])) : null;
}

function money(text: string): { value: bigint; flag: "DB" | "CR" | null } {
  const m = text.trim().match(NUMBER)!;
  const f = m[1]?.toUpperCase();
  const flag = f ? (["DB", "DR", "D"].includes(f) ? "DB" : "CR") : null;
  return { value: parseRupiah(text.replace(/\s*(DB|CR|DR|D|K|C)$/i, "")), flag };
}

function parseLines(lines: Line[]): ParsedStatement {
  const firstHeader = lines.findIndex((l) => headerColumns(l));
  if (firstHeader < 0) {
    throw new ParseError("Tabel transaksi di PDF tidak dikenali (kolom tanggal, keterangan, mutasi/debet-kredit tidak ditemukan). Kirim contoh baris judulnya agar formatnya bisa ditambahkan.");
  }
  const preamble = lines.slice(0, firstHeader).map(lineText).join("\n");
  const allText = lines.map(lineText).join("\n");
  const period = periodOf(preamble) ?? periodOf(allText);
  const accountNumber =
    preamble
      .split("\n")
      .filter((t) => /(no\.?\s*rek|nomor rekening|rekening|account)/i.test(t))
      .map((t) => t.match(/\d[\d-]{5,}\d/)?.[0])
      .find(Boolean)
      ?.replace(/-/g, "") ?? null;

  type Draft = ParsedRow & { flag: "DB" | "CR" | null; parts: string[]; page: number; lastY: number };
  const drafts: Draft[] = [];
  let cols: Column[] | null = null;
  let current: Draft | null = null;
  let opening: bigint | null = null;
  let closing: bigint | null = null;
  let lineNo = 0;

  for (const line of lines) {
    lineNo++;
    const header = headerColumns(line);
    if (header) {
      cols = header;
      current = null;
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
    for (const c of cells) {
      if (NUMBER.test(c.text) && c.x0 > descCol.x0) {
        const col = nearest(cols, c, moneyKinds);
        if (col) {
          nums.push({ kind: col.kind, ...money(c.text) });
          continue;
        }
      }
      if (/^(DB|CR|DR|D|K)$/i.test(c.text) && c.x0 > descCol.x1) {
        flag = /^(DB|DR|D)$/i.test(c.text) ? "DB" : "CR";
        continue;
      }
      if (c.x0 >= dateCol.x1 - 1 || date) descParts.push(c.text);
    }

    if (date) {
      const desc = descParts.join(" ").replace(/\s+/g, " ").trim();
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
        rawRow: `hal. ${line.page} · ${line.cells.map((c) => c.text).join(" | ")}`,
        flag: amt?.flag ?? flag,
        parts: [desc],
        page: line.page,
        lastY: line.y,
      };
      if (!amt && dr === 0n && cr === 0n) current.amount = 0n;
      drafts.push(current);
      continue;
    }

    // Continuation of the previous row's description (same page, close below, not a footer).
    if (current && line.page === current.page && current.lastY - line.y < 30 && !FOOTER.test(text) && descParts.length) {
      current.parts.push(descParts.join(" "));
      current.description = current.parts.join(" ").replace(/\s+/g, " ").trim();
      current.rawRow += ` / ${line.cells.map((c) => c.text).join(" | ")}`;
      current.lastY = line.y;
      if (current.amount === 0n && nums.length) {
        const amt = nums.find((n) => n.kind === "amount" || n.kind === "credit" || n.kind === "debit");
        if (amt) current.amount = amt.kind === "debit" ? -amt.value : amt.value;
        if (amt?.flag) current.flag = amt.flag;
        current.balance ??= nums.find((n) => n.kind === "balance")?.value ?? null;
      }
    } else current = null;
  }

  if (drafts.length === 0) throw new ParseError("Tidak ada baris transaksi yang terbaca dari PDF ini.");

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
    if (f.balance === null) throw new ParseError("Saldo awal tidak ditemukan di PDF (tidak ada SALDO AWAL dan kolom saldo kosong).");
    opening = f.balance - f.amount;
  }
  const bounds = period ?? monthBoundsOf(rows);
  return {
    format: detectFormat(preamble),
    accountNumber,
    periodStart: bounds.start,
    periodEnd: bounds.end,
    openingBalance: opening,
    closingBalance: closing ?? closingFromRows(rows, opening),
    rows,
  };
}
