import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseStatement, parseStatementSections } from "@/lib/import/parsers";
import { guessYear } from "@/lib/import/parsers/tabular";
import { checkContinuity } from "@/lib/import/normalize";
import { YearNeededError } from "@/lib/import/types";
import { htmlXls, workbook, type FixtureCell, type FixtureSheet } from "@/tests/xls-fixture";
import { makePdf, table } from "@/tests/pdf-fixture";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const HEADER: FixtureCell[] = ["TANGGAL ", null, "KETERANGAN ", "DEBET", "KREDIT", "SISA SALDO"];

/**
 * An accountant's working copy of a BCA statement (the shape of a real pilot file, invented figures): one sheet per month,
 * dd/MM dates without a year, SALDO AWAL row, transaction type in an unlabeled column, DEBET = money in.
 */
function workingCopy(opts: { junOpening?: number } = {}): FixtureSheet[] {
  return [
    {
      name: "MAY",
      rows: [
        HEADER,
        ["01/05", "SALDO AWAL", null, null, null, 9_000_000],
        ["02/05", "TRSF E-BANKING CR", "0205/FTSCY/WS95031\nTOKO SATU", 3_000_000, null, 12_000_000],
        ["04/05", "BI-FAST DB", "BIF TRANSFER KE 002\nPT PEMASOK", null, 2_000_000, 10_000_000],
        ["31/05", "BIAYA ADM", null, null, 30_000, 9_970_000],
      ],
    },
    {
      name: "JUN",
      rows: [
        HEADER,
        ["01/06", "SALDO AWAL", null, null, null, opts.junOpening ?? 9_970_000],
        ["03/06", "TRSF E-BANKING CR", "TOKO DUA", 5_000_000, null, (opts.junOpening ?? 9_970_000) + 5_000_000],
      ],
    },
    {
      name: "JUL",
      rows: [
        HEADER,
        ["01/07", "SALDO AWAL", null, null, null, 14_970_000],
        ["09/07", "TRSF E-BANKING DB", "PT PEMASOK", null, 14_611_000, 359_000],
      ],
    },
  ];
}
const FILE = "ESTATEMENT_0123456789_MAY_26-JUL_26 PT UJI.xlsx";

describe("statement workbooks", () => {
  it("asks for the year when the content has none, with a prefill from the file name", async () => {
    const err = await parseStatement(FILE, workbook(workingCopy(), "xlsx")).catch((e) => e);
    expect(err).toBeInstanceOf(YearNeededError);
    expect(err.guess).toBe(2026);
    expect(err.message).toMatch(/tidak mencantumkan tahun/);
  });

  it("joins a month-per-sheet working copy into one continuous statement read the books' way", async () => {
    for (const bookType of ["xlsx", "biff8"] as const) {
      const sections = await parseStatementSections(FILE, workbook(workingCopy(), bookType), { year: 2026 });
      expect(sections).toHaveLength(1);
      const [st] = sections;
      expect(st.section).toBeUndefined();
      expect(st.sheets).toEqual(["MAY", "JUN", "JUL"]);
      expect(iso(st.periodStart)).toBe("2026-05-01");
      expect(iso(st.periodEnd)).toBe("2026-07-31");
      expect(st.openingBalance).toBe(9_000_000n);
      expect(st.closingBalance).toBe(359_000n);
      expect(st.rows.map((r) => r.amount)).toEqual([3_000_000n, -2_000_000n, -30_000n, 5_000_000n, -14_611_000n]);
      expect(st.rows.map((r) => iso(r.date))).toEqual(["2026-05-02", "2026-05-04", "2026-05-31", "2026-06-03", "2026-07-09"]);
      expect(st.rows[0]).toMatchObject({ sheet: "MAY", rowNumber: 3, description: "TRSF E-BANKING CR 0205/FTSCY/WS95031 TOKO SATU" });
      expect(st.rows[3]).toMatchObject({ sheet: "JUN", rowNumber: 3 });
      expect(st.notes).toEqual([
        "3 lembar dibaca sebagai satu rekening koran: MAY, JUN, JUL.",
        "Kolom Debet dibaca sebagai uang masuk (sudut pandang pembukuan): hanya dengan cara itu saldo berjalan nyambung.",
      ]);
      expect(checkContinuity(st)).toMatchObject({ ok: true });
    }
  });

  it("reads a formula balance by its cached result", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("MEI 2026");
    ws.addRow(["TANGGAL", "", "KETERANGAN", "DEBET", "KREDIT", "SISA SALDO"]);
    ws.addRow(["01/05", "SALDO AWAL", "", "", "", 1_000_000]);
    ws.addRow(["02/05", "SETORAN", "", 500_000, "", { formula: "F2+D3-E3", result: 1_500_000 }]);
    ws.addRow(["03/05", "BIAYA ADM", "", "", 10_000, { formula: "F3+D4-E4", result: 1_490_000 }]);
    const st = await parseStatement("kas.xlsx", Buffer.from(await wb.xlsx.writeBuffer()));
    // The year comes from the sheet name: no question asked.
    expect(st.rows.map((r) => [iso(r.date), r.amount, r.balance])).toEqual([["2026-05-02", 500_000n, 1_500_000n], ["2026-05-03", -10_000n, 1_490_000n]]);
    expect(checkContinuity(st).ok).toBe(true);
  });

  it("flags a gap at the sheet boundary", async () => {
    const st = await parseStatement(FILE, workbook(workingCopy({ junOpening: 9_000_000 }), "xlsx"), { year: 2026 });
    const c = checkContinuity(st);
    expect(c.ok).toBe(false);
    expect(c.note).toMatch(/JUN!3/);
  });

  it("rolls the year forward from December to January and keeps small reorders in the same year", async () => {
    const sheets: FixtureSheet[] = [
      { name: "DES", rows: [HEADER, ["01/12", "SALDO AWAL", null, null, null, 100], ["30/12", "SETOR", null, 50, null, 150]] },
      { name: "JAN", rows: [HEADER, ["01/01", "SALDO AWAL", null, null, null, 150], ["05/01", "SETOR", null, 10, null, 160], ["04/01", "SETOR", null, 10, null, 170]] },
    ];
    const st = await parseStatement("kas.xls", workbook(sheets, "biff8"), { year: 2025 });
    expect(st.rows.map((r) => iso(r.date))).toEqual(["2025-12-30", "2026-01-05", "2026-01-04"]);
    expect(iso(st.periodEnd)).toBe("2026-01-31");
  });

  it("lets a sheet that can't tell the direction take the workbook's", async () => {
    const sheets = workingCopy();
    sheets[2].rows = [HEADER, ["01/07", "SALDO AWAL", null, null, null, 14_970_000], ["09/07", "TRSF E-BANKING CR", "TOKO TIGA", 1_000, null, null]];
    const st = await parseStatement(FILE, workbook(sheets, "xlsx"), { year: 2026 });
    expect(st.rows.at(-1)?.amount).toBe(1_000n);
  });

  it("warns when sheets of one account disagree on the direction", async () => {
    const sheets = workingCopy();
    // JUL written the bank's way: kredit = masuk.
    sheets[2].rows = [HEADER, ["01/07", "SALDO AWAL", null, null, null, 14_970_000], ["09/07", "SETORAN", null, null, 30_000, 15_000_000]];
    const st = await parseStatement(FILE, workbook(sheets, "xlsx"), { year: 2026 });
    expect(st.notes?.at(-1)).toMatch(/berbeda antar lembar: MAY, JUN/);
  });

  it("keeps sheets with different account numbers apart and skips a cover sheet", async () => {
    const acct = (no: string, bal: number): FixtureSheet => ({
      name: `REK ${no.slice(-4)}`,
      rows: [[`No. Rekening : ${no}`], ["Periode : 01/08/2026 - 31/08/2026"], ["Tanggal", "Keterangan", "Debet", "Kredit", "Saldo"], ["03/08/2026", "SETORAN", "0", "1.000.000,00", String(bal)]],
    });
    const sections = await parseStatementSections("gabungan.xlsx", workbook([{ name: "Ringkasan", rows: [["Laporan"]] }, acct("1111111111", 5_000_000), acct("2222222222", 7_000_000)], "xlsx"));
    expect(sections.map((s) => [s.accountNumber, s.section?.label, s.openingBalance])).toEqual([
      ["1111111111", "REK 1111", 4_000_000n],
      ["2222222222", "REK 2222", 6_000_000n],
    ]);
  });

  it("attaches sheets without an account number to the one account the others print", async () => {
    const sheets = workingCopy();
    sheets[0].rows = [["No. Rekening : 0123456789"], ...sheets[0].rows];
    const sections = await parseStatementSections(FILE, workbook(sheets, "xlsx"), { year: 2026 });
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ accountNumber: "0123456789", sheets: ["MAY", "JUN", "JUL"] });
    expect(sections[0].section).toBeUndefined();
  });

  it("refuses unnumbered sheets beside several accounts", async () => {
    const sheets = workingCopy();
    sheets[0].rows = [["No. Rekening : 1111111111"], ...sheets[0].rows];
    sheets[1].rows = [["No. Rekening : 2222222222"], ...sheets[1].rows];
    await expect(parseStatement(FILE, workbook(sheets, "xlsx"), { year: 2026 })).rejects.toThrow(/JUL tidak mencantumkan nomor rekening/);
  });

  it("reads explicit zeroes on a SALDO AWAL row as no movement and skips dated rows that move nothing", async () => {
    const rows: FixtureCell[][] = [
      ["Tanggal", "Keterangan", "Debet", "Kredit", "Saldo"],
      ["01/08/2026", "SALDO AWAL", "0,00", "0", "1.000.000,00"],
      ["02/08/2026", "SETORAN", "0", "500.000,00", "1.500.000,00"],
      ["03/08/2026", "INFO SALDO", "0,00", "0,00", "1.500.000,00"],
      ["04/08/2026", "BIAYA ADM", "10.000,00", "0", "1.490.000,00"],
    ];
    const st = await parseStatement("x.xlsx", workbook([{ name: "S", rows }], "xlsx"));
    expect(st.openingBalance).toBe(1_000_000n);
    expect(st.rows.map((r) => [r.description, r.amount])).toEqual([["SETORAN", 500_000n], ["BIAYA ADM", -10_000n]]);
    expect(checkContinuity(st).ok).toBe(true);
  });

  it("keeps the bank's direction when the balance can't tell, and says nothing", async () => {
    const st = await parseStatement("x.xlsx", workbook([{ name: "S", rows: [["Tanggal", "Keterangan", "Debet", "Kredit", "Saldo"], ["01/08/2026", "A", 100, null, 900], ["02/08/2026", "B", null, 50, null]] }], "xlsx"));
    expect(st.rows.map((r) => r.amount)).toEqual([-100n, 50n]);
    expect(st.notes).toEqual([]);
  });

  it("refuses a workbook without any transaction table", async () => {
    await expect(parseStatement("x.xlsx", workbook([{ name: "S", rows: [["Laporan"]] }], "xlsx"))).rejects.toThrow(/Kolom tanggal & keterangan/);
  });
});

describe("text and HTML statements", () => {
  it("reads an HTML table saved as .xls with Indonesian numbers", async () => {
    const st = await parseStatement(
      "mutasi.xls",
      htmlXls([
        ["No. Rekening : 0987654321"],
        ["Tanggal", "Keterangan", "Debet", "Kredit", "Saldo"],
        ["03/08/2026", "SETORAN TUNAI", "0,00", "1.234.567,00", "11.234.567,00"],
        ["05/08/2026", "BIAYA ADM", "15.000,00", "0,00", "11.219.567,00"],
      ]),
    );
    expect(st.accountNumber).toBe("0987654321");
    expect(st.openingBalance).toBe(10_000_000n);
    expect(st.rows.map((r) => r.amount)).toEqual([1_234_567n, -15_000n]);
    expect(st.rows[0].sheet).toBe("Sheet1");
  });

  it("reads tab-separated text whatever its name", async () => {
    const st = await parseStatement("mutasi.xls", Buffer.from("Tanggal\tKeterangan\tDebet\tKredit\tSaldo\n03/08/2026\tSETORAN\t0\t500000\t1500000\n"));
    expect(st.rows[0]).toMatchObject({ amount: 500_000n, balance: 1_500_000n });
    expect(st.rows[0].sheet).toBeUndefined();
  });

  it("asks for the year for a year-less CSV too", async () => {
    const csv = Buffer.from("Tanggal;Keterangan;Debet;Kredit;Saldo\n03/08;SETORAN;0;500000;1500000\n");
    await expect(parseStatement("mutasi_202608.csv", csv)).rejects.toMatchObject({ guess: 2026 });
    expect(iso((await parseStatement("mutasi_202608.csv", csv, { year: 2026 })).rows[0].date)).toBe("2026-08-03");
  });

  it("rejects a date that is not on the calendar", async () => {
    await expect(parseStatement("x.csv", Buffer.from("Tanggal;Keterangan;Debet;Kredit;Saldo\n31/06;A;0;1;1\n"), { year: 2026 })).rejects.toThrow(/kalender/);
  });
});

describe("guessYear", () => {
  it.each([
    ["ESTATEMENT_07655563814_202608.pdf", 2026],
    ["mutasi 2025 final.xlsx", 2025],
    ["ESTATEMENT_x_MAY_26-JUL_26 PT X.xlsx", 2026],
    ["rekening-des'25.xls", 2025],
    ["mutasi.xls", null],
    ["0765556381.xls", null],
  ])("%s → %s", (name, year) => expect(guessYear(name)).toBe(year));
});

describe("BCA e-statement PDF", () => {
  it("is recognised when its notes are letter-spaced", async () => {
    const pdf = makePdf([
      [
        ...table(800, [[[40, "NO. REKENING : 1234567890"]], [[40, "PERIODE : AGUSTUS 2026"]], [[300, "B C A b e r h a k s e t i a p s a a t"]]]),
        ...table(720, [
          [[40, "TANGGAL"], [100, "KETERANGAN"], [410, "MUTASI"], [510, "SALDO"]],
          [[40, "01/08"], [100, "SALDO AWAL"], [490, "1,000,000.00"]],
          [[40, "06/08"], [100, "SETORAN"], [390, "500,000.00"], [490, "1,500,000.00"]],
        ]),
      ],
    ]);
    expect((await parseStatement("e.pdf", pdf)).format).toBe("BCA");
  });

  it("does not see BCA inside other capitals", async () => {
    const pdf = makePdf([
      [
        ...table(800, [[[40, "NO. REKENING : 1234567890"]], [[40, "PERIODE : AGUSTUS 2026"]], [[300, "S U B C A T E G O R Y"]]]),
        ...table(720, [
          [[40, "TANGGAL"], [100, "KETERANGAN"], [410, "MUTASI"], [510, "SALDO"]],
          [[40, "06/08"], [100, "SETORAN"], [390, "500,000.00"], [490, "1,500,000.00"]],
        ]),
      ],
    ]);
    expect((await parseStatement("e.pdf", pdf)).format).toBe("GENERIC");
  });
});
