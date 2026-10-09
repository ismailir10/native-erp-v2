import { describe, expect, it } from "vitest";
import { readGrid, type Grid } from "@/lib/import/grid";
import { checkMapping, guessOrder, readMapped, signatureOf, suggestMapping, type ColumnMapping } from "@/lib/import/mapped";
import { YearNeededError } from "@/lib/import/types";
import { checkContinuity } from "@/lib/import/normalize";
import { CLOSE, expectAugust, EXPECT_AMOUNTS } from "../bank-fixture";
import { unknownCsv, unknownPdf, unknownXlsx } from "../unknown-layout";

const csvGrid = (rows: string[][]): Grid => ({ kind: "CSV", sheets: [{ name: "CSV", rows }], pages: 0 });
const HEAD = ["Tgl", "Uraian Mutasi", "Nilai", "Posisi"];
const signed = (over: Partial<ColumnMapping> = {}): ColumnMapping => ({ sheet: null, firstRow: 2, date: 0, description: [1], amount: { style: "signed", column: 2, direction: null }, balance: 3, order: "DMY", year: null, ...over });

describe("reading a file with the accountant's column mapping", () => {
  it("reads Debet + Kredit columns: Saldo Awal row, descriptions continued on dateless rows, the total row skipped", async () => {
    const g = await readGrid(unknownCsv());
    const m = suggestMapping(g);
    expect(m).toEqual({ sheet: null, firstRow: 5, date: 0, description: [1, 2], amount: { style: "split", debit: 3, credit: 4 }, balance: 5, order: "DMY", year: null });
    const st = readMapped(g, { ...m, description: [2] });
    expectAugust(st);
    expect(st.rows[0].description).toBe("TRSF E-BANKING CR 0108/FTSCY/WS95031 PT MITRA UNGGAS FIKTIF");
    expect(st.rows.map((r) => r.rowNumber)).toEqual([6, 8, 10, 11, 12]);
    expect(st.format).toBe("GENERIC");
    expect(st.notes).toEqual(["1 baris tanpa tanggal atau tanpa nominal dilewati (judul halaman, total, catatan)."]);
  });

  it("reads the PDF version, the opening from the first balance", async () => {
    const g = await readGrid(unknownPdf());
    const st = readMapped(g, suggestMapping(g));
    expectAugust(st);
  });

  it("reads one amount column with a D/C column, newest first turned oldest first, Excel dates", async () => {
    const g = await readGrid(await unknownXlsx());
    const m = suggestMapping(g);
    expect(m.amount).toEqual({ style: "signed", column: 2, direction: 3 });
    expect(m.sheet).toBe("Kas");
    const st = readMapped(g, m);
    expectAugust(st);
    expect(st.rows[0].sheet).toBe("Kas");
    expect(st.rows[0].rowNumber).toBe(8);
  });

  it("reads next month's file the same way, carried on from August's closing", async () => {
    const g = await readGrid(unknownCsv(9));
    const st = readMapped(g, suggestMapping(g));
    expect(st.openingBalance).toBe(BigInt(CLOSE));
    expect(st.rows.map((r) => r.amount)).toEqual(EXPECT_AMOUNTS);
    expect(st.rows[0].date.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(checkContinuity(st).ok).toBe(true);
  });

  it("takes the direction from a marker in the cell, or else from the sign", () => {
    const g = csvGrid([HEAD, ["01/08/2026", "SETOR", "1.000.000,00 CR", "11.000.000,00"], ["02/08/2026", "TARIK", "250.000,00 DB", "10.750.000,00"], ["03/08/2026", "BIAYA", "-5.000", "10.745.000"], ["04/08/2026", "BUNGA", "(1.000)", "10.744.000"]]);
    const st = readMapped(g, signed());
    expect(st.rows.map((r) => r.amount)).toEqual([1_000_000n, -250_000n, -5_000n, -1_000n]);
    expect(st.openingBalance).toBe(10_000_000n);
    expect(checkContinuity(st).ok).toBe(true);
  });

  it("reads month-first dates when told, and guesses the order from a date that can only be one", () => {
    const rows = [HEAD, ["08/01/2026", "A", "100", "1.100"], ["08/13/2026", "B", "100", "1.200"]];
    expect(guessOrder(csvGrid(rows).sheets[0], 2, 0)).toBe("MDY");
    const st = readMapped(csvGrid(rows), signed({ order: "MDY" }));
    expect(st.rows.map((r) => r.date.toISOString().slice(0, 10))).toEqual(["2026-08-01", "2026-08-13"]);
    // Read day-first, 08/13 is no date: that row isn't a transaction (and the draft's proof would show the gap).
    expect(readMapped(csvGrid(rows), signed({ order: "DMY" })).rows.map((r) => r.rowNumber)).toEqual([2]);
  });

  it("asks for the year when the dates print none, and runs on from December into January", () => {
    const rows = [HEAD, ["30/12", "A", "100", "1.100"], ["02/01", "B", "100", "1.200"]];
    expect(() => readMapped(csvGrid(rows), signed())).toThrow(YearNeededError);
    const st = readMapped(csvGrid(rows), signed({ year: 2026 }));
    expect(st.rows.map((r) => r.date.toISOString().slice(0, 10))).toEqual(["2026-12-30", "2027-01-02"]);
  });

  it("refuses words in an amount column with the row number, so a wrong mapping says where", () => {
    const g = csvGrid([HEAD, ["01/08/2026", "SETOR", "TUNAI", "1.000"]]);
    expect(() => readMapped(g, signed())).toThrow('Baris 2: kolom Jumlah berisi "TUNAI", bukan angka. Periksa pemetaan kolomnya.');
  });

  it("skips a header repeated on the next page and rows with a date but no amount", () => {
    const g = csvGrid([HEAD, ["01/08/2026", "A", "100", "1.100"], HEAD, ["01/08/2026", "SALDO", "", "1.100"], ["02/08/2026", "B", "100", "1.200"]]);
    const st = readMapped(g, signed());
    expect(st.rows.map((r) => r.description)).toEqual(["A", "B"]);
    expect(st.notes).toEqual(["1 baris tanpa tanggal atau tanpa nominal dilewati (judul halaman, total, catatan)."]);
  });

  it("refuses a mapping without Saldo, with a column used twice, or naming a column the file doesn't have", () => {
    const g = csvGrid([HEAD, ["01/08/2026", "A", "100", "1.100"]]);
    expect(() => checkMapping(signed({ balance: 9 }), g)).toThrow(/Saldo/);
    expect(() => checkMapping(signed({ description: [2] }), g)).toThrow(/satu peran/);
    expect(() => checkMapping(signed({ firstRow: 0 }), g)).toThrow(/baris transaksi pertama/);
    expect(() => checkMapping(signed({ amount: { style: "split", debit: 2, credit: 7 } }), g)).toThrow(/Debet dan kolom Kredit/);
    expect(() => checkMapping({ ...signed(), sheet: "Lain" }, { ...g, kind: "XLSX" })).toThrow(/Lembar/);
  });

  it("refuses a mapping that finds no transaction row, or an amount past 15 digits", () => {
    expect(() => readMapped(csvGrid([HEAD, ["Total", "", "100", ""]]), signed())).toThrow(/Tidak ada baris transaksi/);
    expect(() => readMapped(csvGrid([HEAD, ["01/08/2026", "A", "1000000000000000000", "1"]]), signed())).toThrow(/terlalu besar di baris 2/);
  });

  it("is remembered under its header's signature; a file without a header row has none", async () => {
    const aug = await readGrid(unknownCsv(8));
    const sep = await readGrid(unknownCsv(9));
    expect(signatureOf(aug, suggestMapping(aug))).toBe(signatureOf(sep, suggestMapping(sep)));
    expect(signatureOf(aug, suggestMapping(aug))).not.toBeNull();
    expect(signatureOf(csvGrid([["01/08/2026", "A", "100", "1.100"]]), signed({ firstRow: 1 }))).toBeNull();
  });
});
