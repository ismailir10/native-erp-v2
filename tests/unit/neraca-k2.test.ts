import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { detectTables, periodHeader, readSheets, readTable } from "@/lib/ledger-import/read";
import { planNeraca } from "@/lib/ledger-import/check";
import { dateOnly } from "@/lib/format";

/** UC-K2: a Neraca balance against its account's nature is flagged, never flipped; extra period columns and a missing month are named. */
async function sheet(rows: unknown[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BS");
  for (const r of rows) ws.addRow(r);
  return readSheets("bs.xlsx", Buffer.from(await wb.xlsx.writeBuffer()));
}
const entity = { entityId: "e1", name: "PT Uji", currency: "IDR" };

describe("Neraca checks (UC-K2)", () => {
  it("reads month headers as period ends", () => {
    expect(periodHeader("Jan 2026")).toEqual(dateOnly(2026, 1, 31));
    expect(periodHeader("Februari 2024")).toEqual(dateOnly(2024, 2, 29));
    expect(periodHeader("Des-25")).toEqual(dateOnly(2025, 12, 31));
    expect(periodHeader("31/03/2026")).toEqual(dateOnly(2026, 3, 31));
    expect(periodHeader("Saldo")).toBeNull();
    expect(periodHeader("1-1000")).toBeNull();
  });

  it("flags a negative receivable and a debit payable as written, without flipping them", async () => {
    const sheets = await sheet([
      ["Kode Akun", "Nama Akun", "Saldo"],
      ["Aset"],
      ["1-100", "Kas", 1000],
      ["1-200", "Piutang Usaha", -200],
      ["Liabilitas"],
      ["2-100", "Utang Usaha", -50],
      ["Ekuitas"],
      ["3-100", "Modal", 750],
    ]);
    const t = detectTables(sheets)[0];
    const read = readTable(sheets, t);
    if (read.mode !== "NERACA") throw new Error("mode");
    const plan = planNeraca(read.rows, read.totals, { entityKey: "", entity, date: dateOnly(2025, 12, 31), sheet: "BS" });
    const signs = plan.checks.filter((c) => c.code === "SIGN_AGAINST_TYPE");
    expect(signs.map((c) => [c.severity, c.message, c.refs])).toEqual([
      ["REVIEW", "PT Uji 1-200 Piutang Usaha: saldo di file kredit Rp 200, berlawanan dengan sifat akunnya. Dicatat apa adanya, tidak dibalik; periksa di file sumber.", ["BS!4"]],
      ["REVIEW", "PT Uji 2-100 Utang Usaha: saldo di file debit Rp 50, berlawanan dengan sifat akunnya. Dicatat apa adanya, tidak dibalik; periksa di file sumber.", ["BS!6"]],
    ]);
    expect(plan.entries[0].lines.find((l) => l.code === "1-200")!.amount).toBe(-200n);
  });

  it("reads the first period column of a Jan–Jun Neraca, names the others and the missing February", async () => {
    const sheets = await sheet([
      ["Kode Akun", "Nama Akun", "Jan 2026", "Mar 2026", "Apr 2026", "Mei 2026", "Jun 2026"],
      ["Aset"],
      ["1-100", "Kas", 100, 110, 120, 130, 140],
      ["Ekuitas"],
      ["3-100", "Modal", 100, 110, 120, 130, 140],
    ]);
    const t = detectTables(sheets)[0];
    expect(t.columns.amount).toBe(2);
    expect(t.periods?.map((p) => p.date.toISOString().slice(0, 10))).toEqual(["2026-01-31", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"]);
    const read = readTable(sheets, t);
    if (read.mode !== "NERACA") throw new Error("mode");
    expect(read.date).toEqual(dateOnly(2026, 1, 31));
    const plan = planNeraca(read.rows, read.totals, { entityKey: "", entity, date: read.date!, sheet: "BS", periods: t.periods, column: t.columns.amount });
    expect(plan.checks.find((c) => c.code === "MULTI_PERIOD")?.message).toBe(
      "File berisi 5 kolom periode. Dibaca sebagai Saldo Awal: 31 Jan 2026; tidak diimpor: 31 Mar 2026, 30 Apr 2026, 31 Mei 2026, 30 Jun 2026 (mutasinya datang dari buku besar atau rekening koran). Kolom Februari 2026 tidak ada di file.",
    );
  });
});

describe("trial balance column groups need numbers", () => {
  it("reads a closing-balance sheet with empty and yes/no 'group' columns as a Neraca from its Debit | Credit columns", async () => {
    // The shape of a reconstruction workbook's opening sheet (invented names and figures).
    const sheets = await sheet([
      ["FOUNDATION & OPENING BRIDGE"],
      [],
      ["Foundation ID", "Source Type", "Account Code", "Account Name", "Debit", "Credit", "Net Movement", "Pooling Adj Integrated?", "Closing 31 Dec 2022 Impact", "Opening 1 Jan 2023 Impact"],
      ["F-1", "KORAN", "10000", "Bank Sentosa - SGD", 8583.5, 0, null, "YES (dalam koran rekonstruksi)", null, null],
      ["F-2", "KORAN", "12000", "Investment on Subsidiary", 3433738.28, 0, null, "YES (dalam koran rekonstruksi)", null, null],
      ["F-3", "KORAN", "30000", "Ordinary Shares", 0, 3442321.78, null, "YES (dalam koran rekonstruksi)", null, null],
    ]);
    const t = detectTables(sheets)[0];
    expect(t.mode).toBe("NERACA");
    expect(t.tb).toBeUndefined();
    const read = readTable(sheets, t);
    if (read.mode !== "NERACA") throw new Error("mode");
    expect(read.rows.map((r) => [r.code, r.amount])).toEqual([["10000", 858350n], ["12000", 343373828n], ["30000", -344232178n]]);
  });
});
