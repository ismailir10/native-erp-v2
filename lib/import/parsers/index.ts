import { ParseError, type ParsedStatement } from "@/lib/import/types";
import { isBcaCsv, parseBca } from "@/lib/import/parsers/bca";
import { isBriCsv, parseBri } from "@/lib/import/parsers/bri";
import { isMandiriRows, parseTabular, xlsxToRows } from "@/lib/import/parsers/tabular";
import { readCsv } from "@/lib/import/parsers/common";
import { parsePdf, parsePdfSections } from "@/lib/import/parsers/pdf";

/** Detect the bank format from content (not the file name) and parse. */
export async function parseStatement(fileName: string, data: Buffer, opts: { password?: string } = {}): Promise<ParsedStatement> {
  try {
    return await parseAny(fileName, data, opts);
  } catch (e) {
    if (e instanceof ParseError) throw e;
    throw new ParseError(`File tidak bisa dibaca: ${(e as Error).message}`);
  }
}

async function parseAny(fileName: string, data: Buffer, opts: { password?: string }): Promise<ParsedStatement> {
  if (data.subarray(0, 5).toString("latin1") === "%PDF-") return parsePdf(data, opts);
  if (/\.xls$/i.test(fileName)) throw new ParseError("File .xls (Excel lama) belum didukung. Buka di Excel lalu simpan sebagai .xlsx atau CSV.");
  if (/\.xlsx$/i.test(fileName)) {
    const rows = await xlsxToRows(data);
    return parseTabular(rows, isMandiriRows(rows) ? "MANDIRI" : "GENERIC");
  }
  const text = data.toString("utf8");
  if (isBcaCsv(text)) return parseBca(text);
  if (isBriCsv(text)) return parseBri(text);
  const delimiter = text.split("\n")[0].includes(";") ? ";" : ",";
  return parseTabular(readCsv(text, delimiter), "GENERIC");
}

/** Every account section in the file (combined PDFs hold several); other formats return one statement. */
export async function parseStatementSections(fileName: string, data: Buffer, opts: { password?: string } = {}): Promise<ParsedStatement[]> {
  try {
    if (data.subarray(0, 5).toString("latin1") === "%PDF-") return await parsePdfSections(data, opts);
    return [await parseAny(fileName, data, opts)];
  } catch (e) {
    if (e instanceof ParseError) throw e;
    throw new ParseError(`File tidak bisa dibaca: ${(e as Error).message}`);
  }
}
