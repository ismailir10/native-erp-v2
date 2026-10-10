import { ParseError, type ParsedRow, type ParsedStatement } from "@/lib/import/types";
import { parseBankAmount, assertSingleSide, closingProvenance, sourceCurrency, closingFromRows, monthBoundsOf, openingFromBalances, parseDateDMY, readCsv, SenWatch } from "@/lib/import/parsers/common";

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

  const currency = sourceCurrency(rows.slice(0, headerIdx).map((r) => r.join(" ")), rows[headerIdx], rows.slice(headerIdx + 1).flatMap((r) => [cDb, cCr, cBal].filter((c) => c >= 0).map((c) => r[c] ?? "")), rows.slice(headerIdx + 1));
  const sen = new SenWatch();
  const parsed: ParsedRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[cDate]) continue;
    for (const c of [cDb, cCr, cBal]) if (c >= 0) sen.check(r[c], i + 1);
    assertSingleSide(r[cDb], r[cCr], i + 1);
    parsed.push({
      date: parseDateDMY(r[cDate]),
      description: r[cDesc].replace(/\s+/g, " ").trim(),
      amount: parseBankAmount(r[cCr]) - parseBankAmount(r[cDb]),
      balance: cBal >= 0 && r[cBal] ? parseBankAmount(r[cBal]) : null,
      rowNumber: i + 1,
      rawRow: r.join(";"),
    });
  }
  const { start, end } = monthBoundsOf(parsed);
  const notes: string[] = [];
  const senNote = sen.note();
  if (senNote) notes.push(senNote);
  let openingBalance = openingFromBalances(parsed);
  if (openingBalance === null) {
    // No row prints a balance (a CMS export without SALDO_AKHIR_MUTASI): the opening is unknown, not silently right.
    openingBalance = 0n;
    notes.push("Kolom saldo kosong di semua baris: saldo awal tidak diketahui dan dianggap 0, sehingga mutasi tidak bisa dicocokkan dengan saldo bank. Isi Saldo Awal sendiri dari rekening koran.");
  }
  return {
    format: "BRI",
    currency,
    provenance: { period: "INFERRED", opening: "DERIVED", closing: closingProvenance(parsed) },
    accountNumber: acctRow?.[1]?.replace(/[^\d]/g, "") ?? null,
    periodStart: start,
    periodEnd: end,
    openingBalance,
    closingBalance: closingFromRows(parsed, openingBalance),
    rows: parsed,
    ...(notes.length ? { notes } : {}),
  };
}
