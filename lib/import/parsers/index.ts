import { ParseError, YearNeededError, type ParsedStatement } from "@/lib/import/types";
import { isBcaCsv, parseBca } from "@/lib/import/parsers/bca";
import { isBriCsv, parseBri } from "@/lib/import/parsers/bri";
import { parseTabular, parseWorkbook, xlsxToSheets } from "@/lib/import/parsers/tabular";
import { decodeText, detectDelimiter, readCsv } from "@/lib/import/parsers/common";
import { parsePdfSections } from "@/lib/import/parsers/pdf";
import { asXlsx, sniffFile } from "@/lib/import/workbook";

export type ParseOptions = {
  /** Used once to open a PDF; never stored. */
  password?: string;
  /** Year of the first month, for files whose dates have none (the accountant's answer to `YearNeededError`). */
  year?: number;
};

/** Detect the bank format from content (not the file name) and parse; the first statement of the file. */
export async function parseStatement(fileName: string, data: Buffer, opts: ParseOptions = {}): Promise<ParsedStatement> {
  return (await parseStatementSections(fileName, data, opts))[0];
}

/** Every statement in the file: combined PDFs and workbooks with several accounts hold one per account. */
export async function parseStatementSections(fileName: string, data: Buffer, opts: ParseOptions = {}): Promise<ParsedStatement[]> {
  try {
    return await parseAny(fileName, data, opts);
  } catch (e) {
    if (e instanceof ParseError) throw e;
    throw new ParseError(`File tidak bisa dibaca: ${(e as Error).message}`);
  }
}

async function parseAny(fileName: string, data: Buffer, opts: ParseOptions): Promise<ParsedStatement[]> {
  if (sniffFile(data) === "PDF") return parsePdfSections(data, opts);
  const xlsx = asXlsx(data);
  if (xlsx) return parseWorkbook(await xlsxToSheets(xlsx), { year: opts.year, fileName });
  const text = decodeText(data);
  const generic = () => {
    const { cursor: _cursor, verdict: _verdict, ...st } = parseTabular(readCsv(text, detectDelimiter(text)), "GENERIC", { year: opts.year, fileName });
    void _cursor;
    void _verdict;
    return [st];
  };
  const specific = isBcaCsv(text) ? () => [parseBca(text)] : isBriCsv(text) ? () => [parseBri(text)] : null;
  if (!specific) return generic();
  try {
    return specific();
  } catch (e) {
    // A file that only looks like BCA's / BRI's may still be a plain table: try the generic reader, keep this error if it can't either.
    if (!(e instanceof ParseError)) throw e;
    try {
      return generic();
    } catch (g) {
      throw g instanceof YearNeededError ? g : e;
    }
  }
}
