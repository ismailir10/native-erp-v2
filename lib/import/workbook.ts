import * as XLSX from "xlsx";
import { ParseError } from "@/lib/import/types";

/**
 * Spreadsheets are recognised from their bytes, never their name (accounting-rules §16). ExcelJS reads .xlsx; everything else
 * a bank or an old system calls "Excel" — legacy BIFF .xls, an HTML table saved as .xls, SpreadsheetML 2003 XML — is read by
 * SheetJS and rewritten as an in-memory .xlsx, so every reader downstream stays the same.
 */
export type FileKind = "PDF" | "XLSX" | "XLS" | "MARKUP" | "TEXT";

const OLE2 = Buffer.from("d0cf11e0", "hex");
const ZIP = Buffer.from("504b0304", "hex");

export function sniffFile(data: Buffer): FileKind {
  if (data.subarray(0, 5).toString("latin1") === "%PDF-") return "PDF";
  // A ZIP local-file header, not just "PK" (a CSV may start with a "PK…" column).
  if (data.subarray(0, 4).equals(ZIP)) return "XLSX";
  if (data.subarray(0, 4).equals(OLE2)) return "XLS";
  const head = stripBom(data.subarray(0, 512)).toString("utf8").trimStart().toLowerCase();
  if (/^<(\?xml|!doctype html|html|table|meta|head|body)/.test(head) || (head.startsWith("<") && /<table|<workbook|urn:schemas-microsoft-com:office/.test(head))) return "MARKUP";
  return "TEXT";
}

function stripBom(b: Buffer) {
  return b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? b.subarray(3) : b;
}

/**
 * The file as an .xlsx buffer when it is any spreadsheet; null for PDF and plain text. Markup cells stay text (`raw`), so an
 * Indonesian "1.234.567,00" is never turned into the number 1.234 — the parsers read it with `parseRupiah` like a CSV cell.
 */
export function asXlsx(data: Buffer): Buffer | null {
  const kind = sniffFile(data);
  if (kind === "XLSX") return data;
  if (kind !== "XLS" && kind !== "MARKUP") return null;
  let wb: XLSX.WorkBook;
  try {
    // An .xls must be a real OLE2 container; without this check SheetJS would read stray bytes as text.
    if (kind === "XLS") XLSX.CFB.read(data, { type: "buffer" });
    wb = XLSX.read(data, { type: "buffer", raw: true, cellDates: false, cellNF: true, cellFormula: false, cellHTML: false, WTF: false });
  } catch (e) {
    if (/password|encrypt/i.test((e as Error).message)) throw new ParseError("File Excel ini dikunci kata sandi. Buka di Excel, hapus kata sandinya, lalu unggah lagi.");
    throw new ParseError("File Excel lama (.xls) tidak bisa dibuka. Buka di Excel lalu simpan sebagai .xlsx.");
  }
  if (!wb.SheetNames.length) throw new ParseError("File Excel kosong");
  // Date cells stay Excel serial numbers with their date format (no JS Date round trip, so no time-zone shift); ExcelJS reads
  // them back as UTC dates.
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellDates: false, compression: false }));
}

/**
 * Like {@link asXlsx}, and also repairs an .xlsx whose date cells are stored as ISO text (`<c t="d">2026-10-02T00:00:00.000Z</c>`, what
 * SheetJS writes with `cellDates` and many web exporters copy). ExcelJS reads that text as the number 2026 — 18 Jul 1905 — so such a
 * file is rewritten by SheetJS first, which turns the cells into real date serials. Other .xlsx files are passed through untouched.
 */
export async function readableXlsx(data: Buffer): Promise<Buffer | null> {
  if (sniffFile(data) !== "XLSX") return asXlsx(data);
  try {
    const wb = XLSX.read(data, { type: "buffer", raw: true, cellDates: false, cellFormula: false, bookFiles: true });
    const files = (wb as unknown as { files?: Record<string, { content?: Uint8Array }> }).files ?? {};
    const iso = Object.entries(files).some(([name, f]) => /^xl\/worksheets\/[^/]+\.xml$/.test(name) && f.content && /<c\b[^>]*\bt="d"/.test(Buffer.from(f.content).toString("utf8")));
    if (!iso) return data;
    return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellDates: false, compression: false }));
  } catch {
    return data;
  }
}
