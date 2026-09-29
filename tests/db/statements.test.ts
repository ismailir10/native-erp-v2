import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { balanceSheet } from "@/lib/reports/ledger";
import { cashFlow, equityChanges, otherComprehensiveIncome } from "@/lib/reports/statements";
import { financialNotes } from "@/lib/reports/notes";
import { financialStatementsWorkbook } from "@/lib/reports/workbook";
import ExcelJS from "exceljs";
import { postOpening } from "@/lib/opening";
import { createLease, postLeaseMonths } from "@/lib/leases/register";
import { importStatement } from "@/lib/import/pipeline";
import { reviewTransaction } from "@/lib/review";
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
    expect(titles).not.toEqual(expect.arrayContaining([expect.stringMatching(/Kelangsungan usaha/)]));
    // The deferred tax line equals the Neraca (nothing posted to 1270/2320 here): the pack's figure is an estimate not yet journalled.
    const taxRows = n.notes.find((x) => x.title === "Pajak penghasilan")?.tables[0].rows.map((r) => r[0]) ?? [];
    expect(taxRows).toContain("Laba sebelum pajak");
    expect(taxRows).not.toContain("Aset pajak tangguhan");
    expect(taxRows).not.toContain("Liabilitas pajak tangguhan");

    // Once journalled, the line shows the posted balance (what the Neraca carries), and only a remaining difference as an estimate.
    const id = async (code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
    await db.$transaction(async (tx) =>
      postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 12, 31), kind: "ADJUSTMENT", memo: "Pajak tangguhan", lines: [{ accountId: await id("1270"), debit: 3n * J }, { accountId: await id("8110"), credit: 3n * J }] }),
    );
    const after = (await financialNotes(db, scope, 2026, 12)).notes.find((x) => x.title === "Pajak penghasilan")!.tables[0].rows;
    expect(after.find((r) => r[0] === "Aset pajak tangguhan")?.[1]).toBe(3n * J);
    const estimate = after.find((r) => String(r[0]).startsWith("Estimasi pajak tangguhan"));
    if (estimate) expect(estimate[1]).not.toBe(0n);
  });

  it("adds a going-concern note when liabilities exceed assets", async () => {
    const g = await makeGroup();
    const id = async (code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
    await db.$transaction(async (tx) =>
      postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 3, 1), kind: "ADJUSTMENT", memo: "Beban dibayar dengan utang", lines: [{ accountId: await id("6190"), debit: 80n * J }, { accountId: await id("2120"), credit: 80n * J }] }),
    );
    const n = await financialNotes(db, { clientId: g.client.id, entityIds: [g.pt.entity.id] }, 2026, 6);
    expect(n.notes[1].title).toBe("Kelangsungan usaha");
    expect(n.notes[1].paragraphs[0]).toBe(
      "Per 30 Jun 2026 liabilitas Rp 80.000.000 melebihi aset Rp 0, sehingga ekuitas -Rp 80.000.000 dengan akumulasi rugi Rp 80.000.000. Kondisi ini menimbulkan ketidakpastian atas kemampuan Entitas mempertahankan kelangsungan usahanya.",
    );
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

  it("keeps non-cash transactions out of investing and financing, and shows lease interest in financing", async () => {
    const g = await makeGroup();
    const id = async (code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
    const post = async (m: number, memo: string, lines: [string, bigint][]) =>
      db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, m, 15), kind: "ADJUSTMENT", memo, lines: await Promise.all(lines.map(async ([code, v]) => (v > 0n ? { accountId: await id(code), debit: v } : { accountId: await id(code), credit: -v }))) }));
    await post(1, "Setoran modal", [["1120", 500n * J], ["3100", -500n * J]]);
    await post(2, "Mesin dibeli kredit", [["1210", 80n * J], ["2110", -80n * J]]);
    await post(3, "Bayar sebagian mesin", [["2110", 30n * J], ["1120", -30n * J]]);
    await post(4, "Sewa: bunga", [["7195", 2n * J], ["2170", -2n * J]]);
    await post(4, "Sewa: bayar", [["2170", 12n * J], ["1120", -12n * J]]);
    const cf = await cashFlow(db, { clientId: g.client.id, entityIds: [g.pt.entity.id] }, dateOnly(2026, 12, 31));
    // Only the 30 jt actually paid for the machine is operating (through the payable); nothing invested on paper.
    expect(cf.investing).toEqual([]);
    expect(cf.operating.map((i) => [i.key, i.amount])).toEqual([["UTANG_USAHA", 50n * J], ["NONCASH", -80n * J], ["LEASE_INTEREST", 2n * J]]);
    expect(cf.totals).toEqual({ OPERATING: -30n * J, INVESTING: 0n, FINANCING: 488n * J });
    expect(cf.financing.find((i) => i.key === "LEASES")!.amount).toBe(-12n * J); // the whole rent paid, interest included
    expect([cf.net, cf.closingCash]).toEqual([458n * J, 458n * J]);
  });

  it("shows leases in the notes as journalled and names a difference with the ledger", async () => {
    const g = await makeGroup();
    const scope = { clientId: g.client.id, entityIds: [g.pt.entity.id] };
    await createLease(db, { clientId: g.client.id, entityId: g.pt.entity.id, name: "Kantor", lessor: "PT Graha", start: "2026-06", months: 24, payment: "10.000.000", intervalMonths: 1, timing: "ARREARS", rate: "12" });
    const note = async () => (await financialNotes(db, scope, 2026, 8)).notes.find((n) => n.title === "Sewa")!;
    // No month journalled yet: nothing depreciated, the liability as recognised — equal to the ledger.
    let n = await note();
    expect(n.tables[0].rows[0]).toEqual(["Kantor · PT Graha", 212_433_873n, 0n, 99_883_098n, 112_550_775n]);
    expect(n.tables[0].total).toEqual(["Buku besar (1230, 1239, 2170, 2400)", 212_433_873n, 0n, 99_883_098n, 112_550_775n]);
    expect(n.paragraphs.join(" ")).not.toMatch(/berbeda/);
    // Three months journalled, rent not yet classified: the note says so instead of showing paid-down schedule figures as the ledger.
    await postLeaseMonths(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month: 8 });
    n = await note();
    expect(n.tables[0].rows[0][2]).toBe(3n * 8_851_411n);
    expect(n.paragraphs.join(" ")).toMatch(/berbeda dengan buku besar/);
  });

  it("classifies a statement row moved out of 1999 in Review by where it went (a loan in financing, rent in financing)", async () => {
    const g = await makeGroup();
    const csv = ["Tanggal;Keterangan;Debet;Kredit;Saldo", "05/06/2026;PENCAIRAN KREDIT BANK;0;200000000;300000000", "30/06/2026;TRSF DB PT GRAHA SEWA JUN;10000000;0;290000000", ""].join("\n");
    await createLease(db, { clientId: g.client.id, entityId: g.pt.entity.id, name: "Kantor", lessor: "PT Graha", start: "2026-06", months: 24, payment: "10.000.000", intervalMonths: 1, timing: "ARREARS", rate: "12" });
    await postLeaseMonths(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month: 6 });
    await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca.csv", data: Buffer.from(csv), provider: null });
    for (const [text, code] of [["KREDIT BANK", "2210"], ["GRAHA", "2170"]] as const) {
      const t = await db.bankTransaction.findFirstOrThrow({ where: { description: { contains: text } } });
      await reviewTransaction(db, { bankTxId: t.id, accountCode: code, taxTag: null });
    }
    const cf = await cashFlow(db, { clientId: g.client.id, entityIds: [g.pt.entity.id] }, dateOnly(2026, 6, 30));
    expect(cf.financing.map((i) => [i.key, i.amount])).toEqual([["LEASES", -10n * J], ["UTANG_BANK", 200n * J]]);
    expect(cf.operating.find((i) => i.key === "LEASE_INTEREST")!.amount).toBe(2_124_338n);
    expect(cf.net).toBe(cf.closingCash - cf.openingCash);
  });

  it("notes a posted deferred tax balance even where no PPh badan reconciliation applies", async () => {
    const g = await makeGroup();
    const id = async (code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
    await db.$transaction(async (tx) =>
      postJournal(tx, { entityId: g.owner.entity.id, date: dateOnly(2026, 3, 31), kind: "ADJUSTMENT", memo: "Pajak tangguhan", lines: [{ accountId: await id("1270"), debit: 2n * J }, { accountId: await id("8110"), credit: 2n * J }] }),
    );
    const n = await financialNotes(db, { clientId: g.client.id, entityIds: [g.owner.entity.id] }, 2026, 6);
    const note = n.notes.find((x) => x.title === "Pajak tangguhan")!;
    expect(note.tables[0].rows).toEqual([["Aset pajak tangguhan", 2n * J]]);
  });
});
