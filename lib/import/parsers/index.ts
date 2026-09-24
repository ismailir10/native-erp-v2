import type { ParsedStatement } from "@/lib/import/types";
import { isBcaCsv, parseBca } from "@/lib/import/parsers/bca";
import { isBriCsv, parseBri } from "@/lib/import/parsers/bri";
import { isMandiriRows, parseTabular, xlsxToRows } from "@/lib/import/parsers/tabular";
import { readCsv } from "@/lib/import/parsers/common";

/** Detect the bank format from content (not the file name) and parse. */
export async function parseStatement(fileName: string, data: Buffer): Promise<ParsedStatement> {
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
