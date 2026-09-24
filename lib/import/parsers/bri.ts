import { parseRupiah } from "@/lib/money";
import { ParseError, type ParsedRow, type ParsedStatement } from "@/lib/import/types";
import { closingFromRows, monthBoundsOf, openingFromRows, parseDateDMY, readCsv } from "@/lib/import/parsers/common";

/** BRI (BRImo/CMS) CSV — semicolon-delimited, ISO dates, plain decimals. Approximated. */
export function isBriCsv(text: string) {
  return /TGL_TRAN/i.test(text.slice(0, 500));
}

export function parseBri(text: string): ParsedStatement {
  const rows = readCsv(text, ";");
  const headerIdx = rows.findIndex((r) => /TGL_TRAN/i.test(r[0]));
  if (headerIdx < 0) throw new ParseError("Header BRI 'TGL_TRAN' tidak ditemukan");
  const acctRow = rows.find((r) => /^NOREK/i.test(r[0]));
  const header = rows[headerIdx].map((h) => h.toUpperCase());
  const col = (name: string) => header.indexOf(name);
  const [cDate, cDesc, cDb, cCr, cBal] = ["TGL_TRAN", "DESK_TRAN", "MUTASI_DEBET", "MUTASI_KREDIT", "SALDO_AKHIR_MUTASI"].map(col);
  if ([cDate, cDesc, cDb, cCr].some((c) => c < 0)) throw new ParseError("Kolom BRI tidak lengkap");

  const parsed: ParsedRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[cDate]) continue;
    parsed.push({
      date: parseDateDMY(r[cDate]),
      description: r[cDesc].replace(/\s+/g, " ").trim(),
      amount: parseRupiah(r[cCr]) - parseRupiah(r[cDb]),
      balance: cBal >= 0 && r[cBal] ? parseRupiah(r[cBal]) : null,
      rowNumber: i + 1,
      rawRow: r.join(";"),
    });
  }
  const { start, end } = monthBoundsOf(parsed);
  const openingBalance = openingFromRows(parsed);
  return {
    format: "BRI",
    accountNumber: acctRow?.[1]?.replace(/[^\d]/g, "") ?? null,
    periodStart: start,
    periodEnd: end,
    openingBalance,
    closingBalance: closingFromRows(parsed, openingBalance),
    rows: parsed,
  };
}
