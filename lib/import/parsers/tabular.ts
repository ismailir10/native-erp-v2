import ExcelJS from "exceljs";
import { parseRupiah } from "@/lib/money";
import type { BankCode } from "@/lib/generated/prisma/enums";
import { ParseError, type ParsedRow, type ParsedStatement } from "@/lib/import/types";
import { closingFromRows, monthBoundsOf, openingFromRows, parseDateDMY, periodFromText } from "@/lib/import/parsers/common";

/**
 * Mandiri (MCM/Livin' export, XLSX) and a generic column-detecting fallback for any
 * CSV/XLSX with recognisable headers (tanggal / keterangan / debet / kredit / saldo).
 */
const HEADER_PATTERNS = {
  date: /^(tanggal|tgl|date|posting date)/i,
  desc: /(keterangan|deskripsi|description|remark|uraian)/i,
  debit: /^(debet|debit|mutasi debet|keluar)/i,
  credit: /^(kredit|credit|mutasi kredit|masuk)/i,
  amount: /^(jumlah|nominal|amount|mutasi)$/i,
  balance: /^(saldo|balance)/i,
};

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && "richText" in v) return v.richText.map((t) => t.text).join("");
  if (typeof v === "object" && "result" in v) return String(v.result ?? "");
  return String(v).trim();
}

export async function xlsxToRows(buf: ArrayBuffer | Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new ParseError("File Excel kosong");
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const vals = (row.values as ExcelJS.CellValue[]).slice(1);
    out.push(vals.map(cellText));
  });
  return out;
}

export function isMandiriRows(rows: string[][]) {
  return rows.slice(0, 8).some((r) => /mandiri/i.test(r.join(" ")));
}

export function parseTabular(rows: string[][], format: BankCode): ParsedStatement {
  const headerIdx = rows.findIndex(
    (r) => r.some((c) => HEADER_PATTERNS.date.test(c)) && r.some((c) => HEADER_PATTERNS.desc.test(c)),
  );
  if (headerIdx < 0) {
    throw new ParseError("Kolom tanggal & keterangan tidak ditemukan. Pastikan baris judul kolom ada.");
  }
  const header = rows[headerIdx];
  const find = (re: RegExp) => header.findIndex((c) => re.test(c));
  const cDate = find(HEADER_PATTERNS.date);
  const cDesc = find(HEADER_PATTERNS.desc);
  const cDb = find(HEADER_PATTERNS.debit);
  const cCr = find(HEADER_PATTERNS.credit);
  const cAmt = find(HEADER_PATTERNS.amount);
  const cBal = find(HEADER_PATTERNS.balance);
  if ((cDb < 0 || cCr < 0) && cAmt < 0) throw new ParseError("Kolom debet/kredit atau jumlah tidak ditemukan");

  let accountNumber: string | null = null;
  let period: { start: Date; end: Date } | null = null;
  for (const r of rows.slice(0, headerIdx)) {
    const line = r.join(" ");
    if (/rekening|account/i.test(line)) accountNumber = line.match(/\d{6,}/)?.[0] ?? accountNumber;
    period = periodFromText(line) ?? period;
  }

  const parsed: ParsedRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[cDate] || /saldo|total/i.test(r[cDate])) continue;
    const amount = cAmt >= 0 && (cDb < 0 || cCr < 0) ? parseRupiah(r[cAmt]) : parseRupiah(r[cCr]) - parseRupiah(r[cDb]);
    parsed.push({
      date: parseDateDMY(r[cDate]),
      description: (r[cDesc] ?? "").replace(/\s+/g, " ").trim(),
      amount,
      balance: cBal >= 0 && r[cBal] ? parseRupiah(r[cBal]) : null,
      rowNumber: i + 1,
      rawRow: r.join(" | "),
    });
  }
  const bounds = period ?? monthBoundsOf(parsed);
  const openingBalance = openingFromRows(parsed);
  return {
    format,
    accountNumber,
    periodStart: bounds.start,
    periodEnd: bounds.end,
    openingBalance,
    closingBalance: closingFromRows(parsed, openingBalance),
    rows: parsed,
  };
}
