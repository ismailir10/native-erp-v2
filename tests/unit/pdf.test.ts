import { describe, expect, it } from "vitest";
import { makePdf, smbcCombinedPdf, table } from "../pdf-fixture";
import { parseStatement } from "@/lib/import/parsers";
import { PdfPasswordError } from "@/lib/import/parsers/pdf";
import { checkContinuity } from "@/lib/import/normalize";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** BCA e-statement style: dd/mm dates, one MUTASI column with DB/CR markers, SALDO AWAL row + footer. */
function bcaPdf() {
  return makePdf([
    [
      ...table(800, [
        [[40, "PT BANK CENTRAL ASIA TBK"]],
        [[40, "REKENING GIRO"]],
        [[40, "NO. REKENING : 8720145566"]],
        [[40, "PERIODE : AGUSTUS 2026"]],
      ]),
      ...table(720, [
        [[40, "TANGGAL"], [100, "KETERANGAN"], [330, "CBG"], [410, "MUTASI"], [510, "SALDO"]],
        [[40, "01/08"], [100, "SALDO AWAL"], [490, "2,554,450,000.00"]],
        [[40, "06/08"], [100, "TRSF E-BANKING CR 0608/FTSCY/WS930729"], [390, "335,350,000.00"], [462, "CR"], [490, "2,889,800,000.00"]],
        [[100, "PT MITRA UNGGAS SENTOSA"]],
        [[40, "07/08"], [100, "TRSF E-BANKING DB 0708/FTSCY/WS913267"], [390, "15,000,000.00"], [462, "DB"], [490, "2,874,800,000.00"]],
        [[100, "KANTOR KONSULTAN PAJAK HARAPAN"]],
        [[40, "31/08"], [100, "BIAYA ADM"], [402, "30,000.00"], [462, "DB"], [490, "2,874,770,000.00"]],
        [[40, "SALDO AWAL : 2,554,450,000.00"]],
        [[40, "MUTASI CR : 335,350,000.00"]],
        [[40, "SALDO AKHIR : 2,874,770,000.00"]],
      ]),
    ],
  ]);
}

/** Mandiri style: full dates (+time), Debit/Kredit columns, Indonesian number format, two pages. */
function mandiriPdf(opts: { userPassword?: string } = {}) {
  const header: [number, string][] = [[40, "Tanggal"], [130, "Keterangan"], [360, "Debit"], [440, "Kredit"], [520, "Saldo"]];
  return makePdf(
    [
      [
        ...table(800, [[[40, "PT Bank Mandiri (Persero) Tbk"]], [[40, "Nomor Rekening : 137-00-9876543-2"]], [[40, "Periode : 01/08/2026 - 31/08/2026"]]]),
        ...table(740, [
          header,
          [[40, "03/08/2026 09:14"], [130, "TRANSFER DARI PT PASAR AYAM MODERN"], [430, "154.099.099,00"], [510, "371.374.099,00"]],
          [[130, "INV-202680"]],
          [[40, "05/08/2026 13:02"], [130, "PEMBAYARAN LISTRIK PLN"], [355, "2.450.000,00"], [510, "368.924.099,00"]],
        ]),
        { x: 280, y: 60, text: "Halaman 1 dari 2" },
      ],
      [
        ...table(800, [
          header,
          [[40, "28/08/2026 16:40"], [130, "BIAYA ADMINISTRASI"], [362, "15.000,00"], [510, "368.909.099,00"]],
        ]),
        { x: 280, y: 60, text: "Halaman 2 dari 2" },
      ],
    ],
    opts,
  );
}

describe("PDF e-statements", () => {
  it("parses a BCA-style statement: markers, continuation lines, opening row, footer totals", async () => {
    const st = await parseStatement("rekening.pdf", bcaPdf());
    expect(st).toMatchObject({ format: "BCA", accountNumber: "8720145566", openingBalance: 2_554_450_000n, closingBalance: 2_874_770_000n });
    expect([iso(st.periodStart), iso(st.periodEnd)]).toEqual(["2026-08-01", "2026-08-31"]);
    expect(st.rows.map((r) => [iso(r.date), r.amount])).toEqual([
      ["2026-08-06", 335_350_000n],
      ["2026-08-07", -15_000_000n],
      ["2026-08-31", -30_000n],
    ]);
    expect(st.rows[0].description).toBe("TRSF E-BANKING CR 0608/FTSCY/WS930729 PT MITRA UNGGAS SENTOSA");
    expect(st.rows[0].rawRow).toMatch(/^hal\. 1 · 06\/08/);
    expect(checkContinuity(st).ok).toBe(true);
  });

  it("parses a Mandiri-style statement across pages with debit/kredit columns", async () => {
    const st = await parseStatement("e-statement.PDF", mandiriPdf());
    expect(st).toMatchObject({ format: "MANDIRI", accountNumber: "1370098765432", openingBalance: 217_275_000n, closingBalance: 368_909_099n });
    expect(st.rows.map((r) => [iso(r.date), r.amount, r.description])).toEqual([
      ["2026-08-03", 154_099_099n, "TRANSFER DARI PT PASAR AYAM MODERN INV-202680"],
      ["2026-08-05", -2_450_000n, "PEMBAYARAN LISTRIK PLN"],
      ["2026-08-28", -15_000n, "BIAYA ADMINISTRASI"],
    ]);
    expect(checkContinuity(st).ok).toBe(true);
  });

  it("asks for the password of a locked PDF and opens it with the right one", async () => {
    const pdf = mandiriPdf({ userPassword: "01011980" });
    await expect(parseStatement("x.pdf", pdf)).rejects.toMatchObject({ reason: "needed" });
    await expect(parseStatement("x.pdf", pdf, { password: "salah" })).rejects.toBeInstanceOf(PdfPasswordError);
    await expect(parseStatement("x.pdf", pdf, { password: "salah" })).rejects.toMatchObject({ reason: "wrong" });
    const st = await parseStatement("x.pdf", pdf, { password: "01011980" });
    expect(st.rows).toHaveLength(3);
  });

  it("explains scanned PDFs and unknown tables instead of guessing", async () => {
    await expect(parseStatement("scan.pdf", makePdf([[]]))).rejects.toThrow(/hasil scan/);
    const prose = makePdf([table(800, [[[40, "Surat keterangan saldo rekening untuk keperluan visa perjalanan."]]])]);
    await expect(parseStatement("surat.pdf", prose)).rejects.toThrow(/Tabel transaksi di PDF tidak dikenali/);
  });

  it("rejects legacy .xls with a way out", async () => {
    await expect(parseStatement("mutasi.xls", Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))).rejects.toThrow(/simpan sebagai \.xlsx/);
  });
});

describe("combined statements (SMBC)", () => {
  it("splits sections, each with its own account, currency and continuity", async () => {
    const { parseStatementSections } = await import("@/lib/import/parsers");
    const sections = await parseStatementSections("Touchbiz_eStatement.pdf", smbcCombinedPdf());
    expect(sections.map((s) => [s.format, s.accountNumber, s.section?.label, s.section?.currency, s.rows.length, s.openingBalance, s.closingBalance])).toEqual([
      ["SMBC", "90022152088", "Jenius Main Account", "IDR", 2, 5_646_633n, 220_646_633n],
      ["SMBC", "05243002879", "Pinjaman Rekening Koran BTB", "IDR", 2, -3_598_843_911n, -3_581_066_684n],
      ["SMBC", "90022164251", "JENIUS JPY ACCOUNT", "JPY", 0, 12_750n, 12_750n],
    ]);
    for (const s of sections) expect(checkContinuity(s).ok).toBe(true);
    expect(sections[0].rows[0].description).toBe("Cr BI fast Incoming"); // posting-date column not in the description
    expect(sections[1].rows.map((r) => r.amount)).toEqual([35_000_000n, -17_222_773n]);
  });
});
