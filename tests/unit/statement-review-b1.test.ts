import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseStatementSections } from "@/lib/import/parsers";
import { checkContinuity } from "@/lib/import/normalize";
import { makePdf, table } from "@/tests/pdf-fixture";

/** The review pass of cycle 5: each case misread a statement (or refused a good one) before its fix. */
async function xlsx(sheets: { name: string; rows: (string | number | null)[][] }[]) {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    s.rows.forEach((r) => ws.addRow(r));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const H = ["Tanggal", "Keterangan", "Debet", "Kredit", "Saldo"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const csv = (...lines: string[]) => Buffer.from(["Tanggal;Keterangan;Debet;Kredit;Saldo", ...lines, ""].join("\n"));
const one = async (name: string, data: Buffer, opts: { year?: number } = {}) => (await parseStatementSections(name, data, opts))[0];

describe("cycle 5 review: statements", () => {
  it("H1: an undated summary line with a balance is never a transaction, nor named as one", async () => {
    const st = await one("x.csv", csv(";SALDO AWAL;;;10.000,00", "01/08/2026;A;0,00;1.000,00;11.000,00", "02/08/2026;B;500,00;0,00;10.500,00", ";Mutasi Debet;500,00;;", ";Mutasi Kredit;;1.000,00;10.500,00", ";Rekap Mutasi;500,00;1.000,00;10.500,00"));
    expect(st.rows.map((r) => r.amount)).toEqual([1000n, -500n]);
    expect(st.notes ?? []).toEqual([]);
    expect(checkContinuity(st).ok).toBe(true);
  });

  it("H2: a slip in the last printed balance flips nothing and keeps a correct closing header; it is named", async () => {
    const st = await one("x.xlsx", await xlsx([{ name: "S", rows: [H, [null, "SALDO AWAL", null, null, 10000], ["01/08/2026", "A", 0, 1000, 11000], ["02/08/2026", "B", 0, 500, 10500], [null, "SALDO AKHIR", null, null, 11500]] }]));
    expect(st.rows.map((r) => r.amount)).toEqual([1000n, 500n]);
    expect(st.closingBalance).toBe(11500n);
    expect(st.notes).toEqual([expect.stringMatching(/saldo menunjukkan arah kebalikan dari yang tertulis \(masuk Rp 500\); tidak diubah/)]);
    expect(checkContinuity(st).ok).toBe(false);
  });

  it("M1: a sparse January-to-November year-less file stays in one year; a December row after a January SALDO AWAL rolls back", async () => {
    const sparse = await one("x.xlsx", await xlsx([{ name: "S", rows: [H, ["SALDO AWAL", null, null, null, 10000], ["15/01", "A", 0, 100, 10100], ["20/11", "B", 0, 100, 10200], ["05/12", "C", 0, 100, 10300]] }]), { year: 2026 });
    expect(sparse.rows.map((r) => iso(r.date))).toEqual(["2026-01-15", "2026-11-20", "2026-12-05"]);
    const e3 = await one("x.xlsx", await xlsx([{ name: "JAN", rows: [H, ["01/01", "SALDO AWAL", null, null, 11000], ["31/12", "B", 500, 0, 10500], ["02/01", "C", 0, 2000, 12500]] }]), { year: 2026 });
    expect(e3.rows.map((r) => iso(r.date))).toEqual(["2025-12-31", "2026-01-02"]);
  });

  it("M2: a statement written from the books' side keeps a balance-only row's amount without flip notes", async () => {
    const st = await one("x.csv", csv(";SALDO AWAL;;;10.000,00", "01/08/2026;A;1.000,00;0,00;11.000,00", "02/08/2026;BIAYA ADMIN;;;10.900,00", "03/08/2026;C;0,00;200,00;10.700,00"));
    expect(st.rows.map((r) => r.amount)).toEqual([1000n, -100n, -200n]);
    expect(st.notes?.some((n) => n.includes("arah dibalik"))).toBe(false);
    expect(checkContinuity(st).ok).toBe(true);
  });

  it("M3/L1: a year typo in a Dec–Jan statement and in a four-row file is read in the statement's year", async () => {
    const decJan = await one("x.csv", csv(";SALDO AWAL;;;10.000,00", "05/01/2025;A;0,00;100,00;10.100,00", "10/12/2025;B;0,00;100,00;10.200,00", "20/12/2025;C;0,00;100,00;10.300,00", "08/01/2026;D;0,00;100,00;10.400,00", "15/01/2026;E;0,00;100,00;10.500,00"));
    expect(iso(decJan.rows[0].date)).toBe("2026-01-05");
    const small = await one("x.csv", csv(";SALDO AWAL;;;10.000,00", "02/08/2023;A;0,00;100,00;10.100,00", "05/08/2026;B;0,00;100,00;10.200,00", "09/08/2026;C;0,00;100,00;10.300,00", "12/08/2026;D;0,00;100,00;10.400,00"));
    expect(iso(small.rows[0].date)).toBe("2026-08-02");
  });

  it("M4: a dated balance-print line is a checkpoint, not a transaction", async () => {
    const st = await one("x.xlsx", await xlsx([{ name: "S", rows: [H, [null, "SALDO AWAL", null, null, 10000], ["01/08/2026", "A", 0, 1000, null], ["01/08/2026", "SALDO PER 01/08", null, null, 11000], ["02/08/2026", "B", 500, 0, 10500]] }]));
    expect(st.rows.map((r) => r.description)).toEqual(["A", "B"]);
  });

  it("M5: a SALDO AWAL row that writes its amount in Debet, in a statement written from the books' side, opens positive", async () => {
    const st = await one("x.xlsx", await xlsx([{ name: "S", rows: [H, ["01/08/2026", "Saldo Awal", 10000, null, null], ["01/08/2026", "A", 1000, 0, 11000], ["02/08/2026", "B", 0, 500, 10500]] }]));
    expect([st.openingBalance, checkContinuity(st).ok]).toEqual([10000n, true]);
  });

  it("M6: a two-month PDF whose first month ends on a row without a balance is not refused", async () => {
    const pdf = makePdf([[
      ...table(800, [[[40, "PT Bank Mandiri (Persero) Tbk"]], [[40, "Nomor Rekening : 137-00-9876543-2"]], [[40, "Periode : 01/07/2026 - 31/08/2026"]]]),
      ...table(740, [
        [[40, "Tanggal"], [130, "Keterangan"], [360, "Debit"], [440, "Kredit"], [520, "Saldo"]],
        [[40, "01/07/2026"], [130, "SALDO AWAL"], [510, "10.000,00"]],
        [[40, "03/07/2026"], [130, "A"], [430, "1.000,00"], [510, "11.000,00"]],
        [[40, "28/07/2026"], [130, "B"], [362, "15,00"]],
        [[40, "01/08/2026"], [130, "SALDO AWAL"], [510, "10.985,00"]],
        [[40, "05/08/2026"], [130, "C"], [430, "100,00"], [510, "11.085,00"]],
      ]),
    ]]);
    const st = await one("m.pdf", pdf);
    expect(st.rows.map((r) => r.amount)).toEqual([1000n, -15n, 100n]);
  });

  it("M7: one account's refusal travels on its own section; the file's other account still reads", async () => {
    const acct = (n: string) => [["Nomor Rekening : " + n], H];
    const rows = (y: number) => [[null, "SALDO AWAL", null, null, 10000], [`25/12/${y}`, "X", 0, 1, 10001], ...["03", "05", "08", "12", "20", "22"].map((d, i) => [`${d}/08/2026`, "Y", 0, 1, 10002 + i])];
    const sections = await parseStatementSections("x.xlsx", await xlsx([
      { name: "A", rows: [...acct("1111111111"), ...rows(2023)] },
      { name: "B", rows: [...acct("2222222222"), [null, "SALDO AWAL", null, null, 500], ["03/08/2026", "Z", 0, 1, 501]] },
    ]));
    expect(sections.map((s) => [s.accountNumber, s.error?.slice(0, 16) ?? null])).toEqual([["1111111111", "Tanggal 25 Des 2"], ["2222222222", null]]);
  });

  it("L2: a sheet named for a range of months raises no month note", async () => {
    const st = await one("x.xlsx", await xlsx([{ name: "Jan-Mar 2026", rows: [H, ["SALDO AWAL", null, null, null, 10000], ["05/01/2026", "A", 0, 100, 10100], ["05/03/2026", "B", 0, 100, 10200]] }]));
    expect(st.notes ?? []).toEqual([]);
  });
});
