import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { balanceSheet } from "@/lib/reports/ledger";
import { cashFlow, equityChanges, otherComprehensiveIncome } from "@/lib/reports/statements";
import { financialNotes } from "@/lib/reports/notes";
import { financialStatementsWorkbook } from "@/lib/reports/workbook";
import ExcelJS from "exceljs";
import { postOpening } from "@/lib/opening";
import { dateOnly } from "@/lib/format";

type G = Awaited<ReturnType<typeof makeGroup>>;
const J = 1_000_000n;

/** A small invented book: 2025 capital and a cash sale; 2026 credit sale, receipt, asset, depreciation, loan, dividend, lease, PSAK 24. */
async function book(g: G) {
  const id = async (code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
  const post = async (y: number, m: number, d: number, memo: string, lines: [string, bigint][]) =>
    db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(y, m, d), kind: "ADJUSTMENT", memo, lines: await Promise.all(lines.map(async ([code, v]) => (v > 0n ? { accountId: await id(code), debit: v } : { accountId: await id(code), credit: -v }))) }));
  await post(2025, 6, 1, "Setoran modal", [["1120", 500n * J], ["3100", -500n * J]]);
  await post(2025, 9, 1, "Penjualan tunai", [["1120", 100n * J], ["4100", -100n * J]]);
  await post(2026, 2, 1, "Penjualan kredit", [["1130", 50n * J], ["4100", -50n * J]]);
  await post(2026, 3, 1, "Penerimaan piutang", [["1120", 30n * J], ["1130", -30n * J]]);
  await post(2026, 3, 5, "Beli mesin", [["1210", 120n * J], ["1120", -120n * J]]);
  await post(2026, 6, 30, "Penyusutan", [["6180", 10n * J], ["1219", -10n * J]]);
  await post(2026, 4, 1, "Pinjaman bank", [["1120", 200n * J], ["2210", -200n * J]]);
  await post(2026, 5, 1, "Dividen", [["3200", 20n * J], ["1120", -20n * J]]);
  await post(2026, 6, 1, "Pengakuan awal sewa", [["1230", 60n * J], ["2400", -60n * J]]);
  await post(2026, 6, 30, "Bayar sewa", [["2400", 5n * J], ["1120", -5n * J]]);
  await post(2026, 12, 31, "Imbalan kerja", [["6105", 3n * J], ["3920", 2n * J], ["2310", -5n * J]]);
}

describe("equity changes, cash flow, other comprehensive income", () => {
  beforeEach(resetDb);

  it("reconciles to the Neraca and to cash", async () => {
    const g = await makeGroup();
    await book(g);
    const scope = { clientId: g.client.id, entityIds: [g.pt.entity.id] };
    const end = dateOnly(2026, 12, 31);

    const oci = await otherComprehensiveIncome(db, scope, dateOnly(2026, 1, 1), end);
    expect(oci).toMatchObject({ total: -2n * J, items: [{ fsLine: "PKL_IMBALAN_KERJA", amount: -2n * J }] });

    const eq = await equityChanges(db, scope, end);
    expect(eq.columns.map((c) => c.fsLine)).toEqual(["MODAL", "SALDO_LABA", "PKL_IMBALAN_KERJA"]);
    expect(eq.values).toMatchObject({ opening: [500n * J, 100n * J, 0n], profit: [0n, 37n * J, 0n], oci: [0n, 0n, -2n * J], retained: [0n, -20n * J, 0n], closing: [500n * J, 117n * J, -2n * J] });
    expect(eq.totals.closing).toBe(615n * J);
    expect(eq.balanceSheetEquity).toBe(615n * J);

    const cf = await cashFlow(db, scope, end);
    expect(cf.netProfit).toBe(37n * J);
    expect(cf.operating.map((i) => [i.key, i.amount])).toEqual([["PIUTANG_USAHA", -20n * J], ["AKUM_PENYUSUTAN", 10n * J], ["BENEFITS", 5n * J], ["OCI", -2n * J]]);
    expect(cf.investing.map((i) => [i.key, i.amount])).toEqual([["ASET_TETAP", -120n * J]]);
    expect(cf.financing.map((i) => [i.key, i.amount])).toEqual([["LEASES", -5n * J], ["UTANG_BANK", 200n * J], ["SALDO_LABA", -20n * J]]);
    expect(cf.totals).toEqual({ OPERATING: 30n * J, INVESTING: -120n * J, FINANCING: 175n * J });
    expect([cf.net, cf.openingCash, cf.closingCash]).toEqual([85n * J, 600n * J, 685n * J]);
    const bs = await balanceSheet(db, scope, end);
    expect(bs.currentAssets.find((i) => i.fsLine === "KAS_SETARA_KAS")?.amount).toBe(cf.closingCash);
  });

  it("drafts the notes from the same figures, with the directors' statement", async () => {
    const g = await makeGroup();
    await book(g);
    const scope = { clientId: g.client.id, entityIds: [g.pt.entity.id] };
    const n = await financialNotes(db, scope, 2026, 12);
    const titles = n.notes.map((x) => `${x.number} ${x.title}`);
    expect(titles.slice(0, 2)).toEqual(["1 Umum", "2 Ikhtisar kebijakan akuntansi"]);
    expect(titles).toEqual(expect.arrayContaining([expect.stringMatching(/ Kas dan setara kas$/), expect.stringMatching(/ Utang bank$/), expect.stringMatching(/ Pendapatan usaha$/), expect.stringMatching(/ Penghasilan komprehensif lain$/)]));
    const bs = await balanceSheet(db, scope, dateOnly(2026, 12, 31));
    const cash = n.notes.find((x) => x.title === "Kas dan setara kas")!.tables[0];
    expect(cash.columns).toEqual(["Akun", "31 Des 2026", "31 Des 2025"]);
    expect(cash.total).toEqual(["Jumlah", bs.currentAssets.find((i) => i.fsLine === "KAS_SETARA_KAS")!.amount, 600n * J]);
    const revenue = n.notes.find((x) => x.title === "Pendapatan usaha")!.tables[0];
    expect(revenue.total).toEqual(["Jumlah", 50n * J, 100n * J]); // 2025: the September cash sale
    expect(n.notes[1].paragraphs.join(" ")).toMatch(/SAK EP/);
    expect(n.directors[1]).toBe(`TENTANG TANGGUNG JAWAB ATAS LAPORAN KEUANGAN ${g.pt.entity.name.toUpperCase()}`);
  });

  it("writes the whole set to one workbook from the same figures", async () => {
    const g = await makeGroup();
    await book(g);
    const scope = { clientId: g.client.id, entityIds: [g.pt.entity.id] };
    const buf = await financialStatementsWorkbook(db, scope, 2026, 12, { firm: "KJA Uji", title: g.pt.entity.name });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Neraca", "Laba Rugi", "Perubahan Ekuitas", "Arus Kas", "CALK", "Pernyataan Direksi"]);
    const find = (sheet: string, label: string) => {
      let out: ExcelJS.CellValue[] | null = null;
      wb.getWorksheet(sheet)!.eachRow((r) => {
        const v = (r.values as ExcelJS.CellValue[]).slice(1);
        if (String(v[0] ?? "").trim() === label) out = v.slice(1);
      });
      return out;
    };
    expect(find("Neraca", "JUMLAH ASET")).toEqual([875_000_000, 600_000_000]);
    expect(find("Neraca", "JUMLAH LIABILITAS DAN EKUITAS")).toEqual([875_000_000, 600_000_000]);
    expect(find("Laba Rugi", "Laba bersih")).toEqual([37_000_000, 100_000_000]);
    expect(find("Laba Rugi", "Total penghasilan komprehensif")).toEqual([35_000_000, 100_000_000]);
    expect(find("Perubahan Ekuitas", "Saldo 31 Des 2026")).toEqual([500_000_000, 117_000_000, -2_000_000, 615_000_000]);
    expect(find("Arus Kas", "Kenaikan (penurunan) bersih kas dan setara kas")).toEqual([85_000_000]);
    expect(find("Arus Kas", "Kas dan setara kas 31 Des 2026")).toEqual([685_000_000]);
    expect(find("CALK", "1. UMUM")).toEqual([]);
    expect(String(wb.getWorksheet("Pernyataan Direksi")!.getRow(1).getCell(1).value)).toBe("SURAT PERNYATAAN DIREKSI");
  });

  it("treats a Saldo Awal inside the year as the opening balance, not a flow", async () => {
    const g = await makeGroup();
    // Books start on 28 February 2026: bank 300 jt, receivables 140 jt, capital 250 jt, retained earnings 190 jt.
    await postOpening(db, { clientId: g.client.id, entityId: g.pt.entity.id, date: dateOnly(2026, 2, 28), lines: [
      { accountCode: "1120", debit: "300000000", credit: "0" },
      { accountCode: "1130", debit: "140000000", credit: "0" },
      { accountCode: "3100", debit: "0", credit: "250000000" },
      { accountCode: "3200", debit: "0", credit: "190000000" },
    ] });
    const id = async (code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
    await db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 4, 1), kind: "ADJUSTMENT", memo: "Penerimaan piutang", lines: [{ accountId: await id("1120"), debit: 40n * J }, { accountId: await id("1130"), credit: 40n * J }] }));
    const scope = { clientId: g.client.id, entityIds: [g.pt.entity.id] };
    const end = dateOnly(2026, 8, 31);
    const cf = await cashFlow(db, scope, end);
    expect(cf.openedAt.toISOString().slice(0, 10)).toBe("2026-02-28");
    expect([cf.openingCash, cf.net, cf.closingCash]).toEqual([300n * J, 40n * J, 340n * J]);
    expect(cf.operating.map((i) => [i.key, i.amount])).toEqual([["PIUTANG_USAHA", 40n * J]]);
    expect(cf.financing).toEqual([]);
    const eq = await equityChanges(db, scope, end);
    expect(eq.values.opening).toEqual([250n * J, 190n * J]);
    expect(eq.totals).toMatchObject({ capital: 0n, retained: 0n, profit: 0n, closing: 440n * J });
    expect(eq.balanceSheetEquity).toBe(440n * J);
  });
});
