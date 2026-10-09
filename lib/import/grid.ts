import { createHash } from "node:crypto";
import { decodeText, detectDelimiter, readCsv } from "@/lib/import/parsers/common";
import { readLines, type Line } from "@/lib/import/parsers/pdf";
import { xlsxToSheets } from "@/lib/import/parsers/tabular";
import { readableXlsx, sniffFile } from "@/lib/import/workbook";
import { ParseError } from "@/lib/import/types";

/**
 * A statement file as the accountant sees it in *Atur kolom*: rows of cells, numbered as the file numbers them. CSV and Excel cells are
 * as written; a text PDF's lines are cut into the columns its page uses. Built only from the uploaded bytes, on the server.
 */
export type GridKind = "CSV" | "XLSX" | "PDF";
export type GridSheet = { name: string; rows: string[][] };
export type Grid = { kind: GridKind; sheets: GridSheet[]; pages: number };

/** A PDF read for the grid stays bounded: a statement of a few hundred pages is no bank statement anymore. */
const PDF_LIMITS = { maxPages: 200, maxItems: 400_000 };

export async function readGrid(data: Buffer, opts: { password?: string } = {}): Promise<Grid> {
  if (sniffFile(data) === "PDF") {
    const lines = await readLines(data, opts.password, PDF_LIMITS);
    if (!lines.length) throw new ParseError("PDF ini tidak berisi teks yang bisa dibaca.");
    return { kind: "PDF", sheets: [{ name: "PDF", rows: pdfRows(lines) }], pages: Math.max(...lines.map((l) => l.page)) };
  }
  const xlsx = await readableXlsx(data);
  if (xlsx) {
    const sheets = (await xlsxToSheets(xlsx)).filter((s) => s.rows.some((r) => r.some((c) => c.trim())));
    if (!sheets.length) throw new ParseError("File Excel kosong");
    return { kind: "XLSX", sheets: sheets.map((s) => ({ name: s.name, rows: s.rows.map(trimRow) })), pages: 0 };
  }
  const text = decodeText(data);
  const rows = readCsv(text, detectDelimiter(text)).map(trimRow);
  while (rows.length && !rows[rows.length - 1].length) rows.pop();
  if (!rows.length) throw new ParseError("File kosong.");
  return { kind: "CSV", sheets: [{ name: "CSV", rows }], pages: 0 };
}

/** Cells without the empty ones a spreadsheet pads a row with on the right. */
function trimRow(r: string[]): string[] {
  const out = r.map((c) => (c ?? "").replace(/\s+/g, " ").trim());
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

/**
 * A text PDF's lines as rows of the same columns. The columns are the cells of the widest line among those at least as wide as the
 * common transaction line (3 cells or more): on a statement that is the column header, where a transaction row fills only one of
 * Debet/Kredit. Lines of that width widen the bands; every cell of every line then goes to the band it overlaps most (or the nearest
 * one), so a description that runs long still lands in its column. Page headers and footers stay in, as they are printed.
 */
export function pdfRows(lines: Line[]): string[][] {
  const tally = new Map<number, number>();
  for (const l of lines) if (l.cells.length >= 3) tally.set(l.cells.length, (tally.get(l.cells.length) ?? 0) + 1);
  const common = [...tally.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0];
  if (!common) return lines.map((l) => l.cells.map((c) => c.text));
  // At most a few columns wider than the common line: a stray line of many words is no header.
  const width = Math.max(...[...tally.keys()].filter((k) => k >= common && k <= common + 4));
  const bands = lines.find((l) => l.cells.length === width)!.cells.map((c) => ({ x0: c.x0, x1: c.x1 }));
  const bandOf = (c: { x0: number; x1: number }) => {
    let best = 0;
    let bestScore = -Infinity;
    bands.forEach((b, i) => {
      const overlap = Math.min(b.x1, c.x1) - Math.max(b.x0, c.x0);
      // Overlap wins; without any, the nearest band (a negative score: minus the distance between centres).
      const score = overlap > 0 ? overlap : -Math.abs((b.x0 + b.x1) / 2 - (c.x0 + c.x1) / 2) - 1e6;
      if (score > bestScore) [best, bestScore] = [i, score];
    });
    return best;
  };
  for (const l of lines) {
    if (l.cells.length !== width) continue;
    l.cells.forEach((c, i) => {
      bands[i].x0 = Math.min(bands[i].x0, c.x0);
      bands[i].x1 = Math.max(bands[i].x1, c.x1);
    });
  }
  return lines.map((l) => {
    const row: string[] = Array(width).fill("");
    for (const c of l.cells) {
      const i = bandOf(c);
      row[i] = row[i] ? `${row[i]} ${c.text}` : c.text;
    }
    return trimRow(row);
  });
}

/** Header text as compared: lower case, single spaces, no punctuation around it. */
const norm = (c: string) => c.toLowerCase().replace(/\s+/g, " ").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/**
 * A layout's fingerprint: the file kind and its header row's cells, normalised. The same export of the same bank gives the same
 * signature month after month; a renamed column gives another (the accountant maps once more, nothing is applied by a near match).
 */
export function layoutSignature(kind: GridKind, header: string[]): string | null {
  const cells = header.map(norm);
  // A header names at least three columns in words; a data row (dates, amounts) is no fingerprint.
  if (cells.filter((c) => /\p{L}{2,}/u.test(c)).length < 3) return null;
  return createHash("sha256").update(JSON.stringify([kind, cells])).digest("hex");
}

/** Whether two rows are the same header (a header repeated on every PDF page is no transaction row). */
export function sameRow(a: string[], b: string[]): boolean {
  const x = a.map(norm).filter(Boolean);
  const y = b.map(norm).filter(Boolean);
  return x.length > 0 && x.length === y.length && x.every((c, i) => c === y[i]);
}
