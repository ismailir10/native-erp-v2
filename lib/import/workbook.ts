import * as XLSX from "xlsx";
import { ParseError } from "@/lib/import/types";

/**
 * Spreadsheets are recognised from their bytes, never their name (accounting-rules §16). ExcelJS reads .xlsx; everything else
 * a bank or an old system calls "Excel" — legacy BIFF .xls, an HTML table saved as .xls, SpreadsheetML 2003 XML — is read by
 * SheetJS and rewritten as an in-memory .xlsx, so every reader downstream stays the same.
 */
export type FileKind = "PDF" | "XLSX" | "XLS" | "MARKUP" | "TEXT";

const OLE2 = Buffer.from("d0cf11e0a1b11ae1", "hex");

export function sniffFile(data: Buffer): FileKind {
  if (data.subarray(0, 5).toString("latin1") === "%PDF-") return "PDF";
  if (data.subarray(0, 2).toString("latin1") === "PK") return "XLSX";
  if (data.subarray(0, 8).equals(OLE2)) return "XLS";
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
