import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { detectTables, editDistance, nearestWord, readSheets, readTable } from "@/lib/ledger-import/read";

/** UC-K2: a typo in a column header must not hide the column, and the reading is shown. */
async function workbook(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("GL");
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const WORDS = { credit: ["kredit", "credit"], desc: ["keterangan"], date: ["tanggal"], amount: ["saldo akhir", "balance"] };

describe("header typos", () => {
  it("counts a swap of neighbours as one edit and stops early past the allowance", () => {
    expect(editDistance("kredti", "kredit", 1)).toBe(1);
    expect(editDistance("keteranagn", "keterangan", 2)).toBe(1);
    expect(editDistance("adjusment", "adjustment", 2)).toBe(1);
    expect(editDistance("debit", "kredit", 1)).toBe(2);
  });

  it("reads the listed typos and never a short or distant word", () => {
    expect(nearestWord("Kredti", WORDS)?.key).toBe("credit");
    expect(nearestWord("Keteranagn", WORDS)?.key).toBe("desc");
    expect(nearestWord("Saldo Akhri", WORDS)?.key).toBe("amount");
    expect(nearestWord("Tangal", WORDS)?.key).toBe("date");
    expect(nearestWord("BALANCI", WORDS)?.key).toBe("amount");
    // Under five letters only an exact word counts; far words never.
    expect(nearestWord("Dat", { date: ["date"] })).toBeUndefined();
    expect(nearestWord("Debit Note", WORDS)).toBeUndefined();
    expect(nearestWord("Kategori", WORDS)).toBeUndefined();
    // Equally near two columns' words: left unread.
    expect(nearestWord("abcde", { debit: ["abcdf"], credit: ["abcdg"] })).toBeUndefined();
  });

  it("finds a ledger whose headers carry typos and says which columns it read through one", async () => {
    const buf = await workbook([
      ["Tangal", "Kode Akun", "Nama Akun", "Debet", "Kredti", "Keteranagn"],
      ["31/01/2026", "1101", "Kas", 500, 0, "setoran"],
      ["31/01/2026", "4100", "Pendapatan", 0, 500, "setoran"],
    ]);
    const sheets = await readSheets("gl.xlsx", buf);
    const [t] = detectTables(sheets);
    expect(t).toMatchObject({ mode: "LEDGER" });
    expect(t.typos?.map((x) => [x.header, x.label])).toEqual([["Tangal", "Tanggal"], ["Kredti", "Kredit"], ["Keteranagn", "Keterangan"]]);
    const res = readTable(sheets, t);
    if (res.mode !== "LEDGER") throw new Error("mode");
    expect(res.rows.map((r) => [r.code, r.debit, r.credit, r.description])).toEqual([["1101", 50000n, 0n, "setoran"], ["4100", 0n, 50000n, "setoran"]]);
  });

  it("leaves well-spelled headers alone: no typo reported", async () => {
    const sheets = await readSheets("gl.xlsx", await workbook([["Tanggal", "Kode Akun", "Nama Akun", "Debit", "Kredit"], ["31/01/2026", "1101", "Kas", 1, 0]]));
    expect(detectTables(sheets)[0].typos).toBeUndefined();
  });
});
