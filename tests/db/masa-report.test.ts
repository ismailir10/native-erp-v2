import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { dateOnly } from "@/lib/format";
import { masaReport, rowNotes, terNote } from "@/lib/tax/masa-report";
import { runControls } from "@/lib/controls";
import { masaWorkbook } from "@/lib/tax/masa-workbook";
import { postPpnOffset } from "@/lib/tax/ppn-offset";
import { taxSummary } from "@/lib/reports/tax";

// Pajak masa (I4c): each tax judged on what was booked for the masa and the bank payments filed to it by the due date.
type G = Awaited<ReturnType<typeof makeGroup>>;
let g: G;
let n = 0;

beforeEach(async () => {
  await resetDb();
  g = await makeGroup();
});

const id = async (code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
type L = { code: string; debit?: bigint; credit?: bigint };
async function post(date: Date, lines: L[], kind: "ADJUSTMENT" | "OPENING" = "ADJUSTMENT") {
  const resolved: { accountId: string; debit?: bigint; credit?: bigint }[] = [];
  for (const l of lines) resolved.push({ accountId: l.code === "BANK" ? g.pt.banks[0].accountId : await id(l.code), debit: l.debit, credit: l.credit });
  return db.$transaction((tx) => postJournal(tx, { entityId: g.pt.entity.id, date, kind, memo: `j${++n}`, lines: resolved }));
}
const d = (m: number, day: number) => dateOnly(2026, m, day);
const report = (month: number, now = d(10, 1)) => masaReport(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month, now }).then((r) => r!);
const row = async (month: number, key: string, now?: Date) => (await report(month, now)).rows.find((r) => r.key === key)!;

describe("masaReport — PPN", () => {
  it("passes a masa paid in full by the end of the next month", async () => {
    await post(d(7, 5), [{ code: "BANK", debit: 11_100n }, { code: "4100", credit: 10_000n }, { code: "2130", credit: 1_100n }]);
    await post(d(7, 9), [{ code: "5100", debit: 4_000n }, { code: "1150", debit: 400n }, { code: "BANK", credit: 4_400n }]);
    await post(d(8, 20), [{ code: "2130", debit: 700n }, { code: "BANK", credit: 700n }]);
    await post(d(8, 6), [{ code: "BANK", debit: 22_200n }, { code: "4100", credit: 20_000n }, { code: "2130", credit: 2_200n }]);
    const r = await row(8, "PPN");
    expect(r.previous).toMatchObject({ owed: 700n, state: "LUNAS", short: 0n });
    // July's masukan 400 is still on 1150: compensating it is the masa-end journal still to post.
    expect(r.ppn).toEqual({ keluaran: 2_200n, masukan: 0n, carryIn: 0n, carryOut: 0n, offset: 400n, offsetLater: null });
    expect(r).toMatchObject({ owed: 2_200n, balance: 2_200n, other: 0n, status: "PASS" });
    expect(r.due).toEqual(d(9, 30));
  });

  it("flags a masa paid short after its due date, and carries a lebih bayar forward", async () => {
    await post(d(6, 9), [{ code: "5100", debit: 9_000n }, { code: "1150", debit: 900n }, { code: "BANK", credit: 9_900n }]); // June: lebih bayar 900
    await post(d(7, 5), [{ code: "BANK", debit: 16_650n }, { code: "4100", credit: 15_000n }, { code: "2130", credit: 1_650n }]); // July: 1.650 − 900 = 750
    await post(d(8, 20), [{ code: "2130", debit: 500n }, { code: "BANK", credit: 500n }]);
    const r = await row(8, "PPN", d(9, 10));
    expect(r.previous).toMatchObject({ owed: 750n, state: "KURANG", short: 250n });
    expect(r.other).toBe(0n);
    expect(r.status).toBe("REVIEW");
    expect(rowNotes(r)[0]).toMatch(/Masa Juli 2026: Rp 250 dari Rp 750 belum disetor sampai jatuh tempo 31 Agu 2026/);
    const june = await row(6, "PPN");
    expect(june.ppn?.carryOut).toBe(900n);
    expect(rowNotes(june).join(" ")).toMatch(/lebih bayar Rp 900 dikompensasikan/);
    // Before the due date a shortfall is not yet late.
    expect((await row(8, "PPN", d(8, 25))).previous.state).toBe("BELUM_JATUH_TEMPO");
  });
});

describe("masaReport — corrections", () => {
  it("nets a correction that takes PPN back off: keluaran and masukan follow the books, not the first posting", async () => {
    // A receipt first booked with PPN keluaran, then corrected to no tax (RECLASS: Dr 2130 / Cr 4100); a purchase the other way round.
    await post(d(8, 5), [{ code: "BANK", debit: 11_100n }, { code: "4100", credit: 10_000n }, { code: "2130", credit: 1_100n }]);
    await post(d(8, 6), [{ code: "2130", debit: 1_100n }, { code: "4100", credit: 1_100n }]);
    await post(d(8, 9), [{ code: "5100", debit: 4_000n }, { code: "1150", debit: 400n }, { code: "BANK", credit: 4_400n }]);
    await post(d(8, 10), [{ code: "5100", debit: 400n }, { code: "1150", credit: 400n }]);
    const r = await row(8, "PPN");
    expect(r.ppn).toEqual({ keluaran: 0n, masukan: 0n, carryIn: 0n, carryOut: 0n, offset: 0n, offsetLater: null });
    expect(r).toMatchObject({ owed: 0n, balance: 0n, other: 0n, status: "PASS" });
  });
});

describe("kompensasi PPN", () => {
  const offset = (month: number) => postPpnOffset(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month });
  const entries = () => db.journalEntry.findMany({ where: { sourceRef: { startsWith: "ppn-offset:" } }, include: { lines: { include: { account: true } } }, orderBy: { createdAt: "asc" } });

  it("credits the masukan not yet compensated against keluaran at the masa end; the masa's figures and balance stay as they were", async () => {
    await post(d(7, 5), [{ code: "BANK", debit: 11_100n }, { code: "4100", credit: 10_000n }, { code: "2130", credit: 1_100n }]);
    await post(d(7, 9), [{ code: "5100", debit: 4_000n }, { code: "1150", debit: 400n }, { code: "BANK", credit: 4_400n }]);
    await post(d(8, 20), [{ code: "2130", debit: 700n }, { code: "BANK", credit: 700n }]);
    await post(d(8, 6), [{ code: "BANK", debit: 22_200n }, { code: "4100", credit: 20_000n }, { code: "2130", credit: 2_200n }]);
    await post(d(8, 12), [{ code: "5100", debit: 3_000n }, { code: "1150", debit: 300n }, { code: "BANK", credit: 3_300n }]);
    const before = await row(8, "PPN");
    expect(before.ppn).toMatchObject({ keluaran: 2_200n, masukan: 300n, offset: 700n });

    // July's 400 and August's 300 in one entry, dated 31 August.
    await offset(8);
    const [e] = await entries();
    expect(e).toMatchObject({ date: d(8, 31), kind: "ADJUSTMENT", sourceRef: "ppn-offset:2026-08", memo: "Kompensasi PPN masukan ke PPN keluaran masa Agustus 2026" });
    expect(e.lines.map((l) => [l.account.code, l.debit, l.credit])).toEqual([["2130", 700n, 0n], ["1150", 0n, 700n]]);
    const after = await row(8, "PPN");
    expect(after.ppn).toMatchObject({ keluaran: 2_200n, masukan: 300n, carryOut: 0n, offset: 0n });
    expect(after).toMatchObject({ owed: before.owed, balance: before.balance, other: 0n, status: "PASS" });
    // Not a remittance either: the client's tax card still counts only the bank payment as disetor.
    expect(await taxSummary(db, { clientId: g.client.id, entityIds: [g.pt.entity.id] }, d(8, 1), d(8, 31))).toMatchObject({ ppnKeluaran: 2_200n, ppnMasukan: 300n, ppnDisetor: 700n });

    await expect(offset(8)).rejects.toThrow("Tidak ada PPN masukan yang perlu dikompensasikan masa Agustus 2026.");
    // July reads the August entry as done: compensating July now would count it twice.
    expect((await row(7, "PPN")).ppn).toMatchObject({ offset: 0n, offsetLater: d(8, 31) });
    await expect(offset(7)).rejects.toThrow("Kompensasi PPN sudah dijurnal per 31 Agu 2026.");

    // A masukan taken back off after the compensation (dated in August): the masa now compensated too much, and one click reverses it.
    await post(d(8, 25), [{ code: "5100", debit: 300n }, { code: "1150", credit: 300n }]);
    expect((await row(8, "PPN")).ppn).toMatchObject({ masukan: 0n, offset: -300n });
    await offset(8);
    expect((await entries())[1].lines.map((l) => [l.account.code, l.debit, l.credit])).toEqual([["1150", 300n, 0n], ["2130", 0n, 300n]]);
    expect((await row(8, "PPN")).ppn).toMatchObject({ masukan: 0n, offset: 0n });
  });

  it("leaves a lebih bayar on 1150 and compensates it in the masa that uses it", async () => {
    await post(d(6, 9), [{ code: "5100", debit: 9_000n }, { code: "1150", debit: 900n }, { code: "BANK", credit: 9_900n }]);
    await post(d(7, 5), [{ code: "BANK", debit: 16_650n }, { code: "4100", credit: 15_000n }, { code: "2130", credit: 1_650n }]);
    expect((await row(6, "PPN")).ppn).toMatchObject({ carryOut: 900n, offset: 0n });
    await expect(offset(6)).rejects.toThrow("Tidak ada PPN masukan yang perlu dikompensasikan masa Juni 2026.");
    expect((await row(7, "PPN")).ppn).toMatchObject({ carryIn: 900n, carryOut: 0n, offset: 900n });
    await offset(7);
    const r = await row(7, "PPN");
    expect(r).toMatchObject({ owed: 750n, balance: 750n, other: 0n });
    expect(r.ppn).toMatchObject({ keluaran: 1_650n, masukan: 0n, carryIn: 900n, offset: 0n });
  });
});

describe("masaReport — PPh 21, 23", () => {
  it("passes PPh 21 withheld from payroll and paid by the 15th, and checks it against TER", async () => {
    for (const m of [7, 8]) await post(d(m, 25), [{ code: "6100", debit: 10_000_000n }, { code: "BANK", credit: 9_800_000n }, { code: "2140", credit: 200_000n }]);
    await post(d(8, 10), [{ code: "2140", debit: 200_000n }, { code: "BANK", credit: 200_000n }]);
    await db.employee.create({ data: { firmId: g.firm.id, clientId: g.client.id, entityId: g.pt.entity.id, name: "Ani", sex: "FEMALE", birthDate: dateOnly(1990, 1, 1), hireDate: dateOnly(2020, 1, 1), wage: 10_000_000n, ptkpStatus: "TK0" } });
    await db.employee.create({ data: { firmId: g.firm.id, clientId: g.client.id, entityId: g.pt.entity.id, name: "Budi (keluar)", sex: "MALE", birthDate: dateOnly(1990, 1, 1), hireDate: dateOnly(2020, 1, 1), wage: 9_000_000n, ptkpStatus: "K1", leftOn: d(7, 31) } });
    const rep = await report(8);
    const r = rep.rows.find((x) => x.key === "PPH_21")!;
    expect(r.previous).toMatchObject({ owed: 200_000n, state: "LUNAS" });
    expect(r).toMatchObject({ owed: 200_000n, balance: 200_000n, other: 0n, netPayroll: false, status: "PASS" });
    expect(r.due).toEqual(d(9, 15));
    expect(rep.ter).toMatchObject({ state: "CHECKED", estimate: 200_000n, booked: 200_000n, missing: 0, status: "PASS" });
    expect(rep.ter.state === "CHECKED" && rep.ter.employees.map((e) => [e.name, e.category, e.rate])).toEqual([["Ani", "A", 200]]);
  });

  it("takes an employee leaving in the masa out of TER: the last masa is Pasal 17 for the months worked less TER before it", async () => {
    await db.employee.create({ data: { firmId: g.firm.id, clientId: g.client.id, entityId: g.pt.entity.id, name: "Ani", sex: "FEMALE", birthDate: dateOnly(1990, 1, 1), hireDate: dateOnly(2020, 1, 1), wage: 10_000_000n, ptkpStatus: "TK0" } });
    await db.employee.create({ data: { firmId: g.firm.id, clientId: g.client.id, entityId: g.pt.entity.id, name: "Dodi", sex: "MALE", birthDate: dateOnly(1988, 1, 1), hireDate: dateOnly(2019, 1, 1), wage: 20_000_000n, ptkpStatus: "TK0", leftOn: d(6, 30) } });
    const june = (await report(6)).ter;
    // Ani: TER 2 % of 10 jt. Dodi leaves 30 June: 6 months, bruto 120 jt − biaya jabatan 3 jt − PTKP 54 jt = PKP 63 jt → 3,45 jt;
    // TER January–May 9 % × 20 jt × 5 = 9 jt → lebih potong 5,55 jt in his last masa.
    expect(june.state === "CHECKED" && june.employees.map((e) => e.name)).toEqual(["Ani"]);
    expect(june.state === "CHECKED" && june.leavers.map((e) => [e.name, e.months, e.pkp, e.annual, e.ter, e.december])).toEqual([["Dodi", 6, 63_000_000n, 3_450_000n, 9_000_000n, -5_550_000n]]);
    expect(june).toMatchObject({ estimate: 200_000n - 5_550_000n });
    expect(terNote(june)).toMatch(/^Estimasi PPh 21 lebih potong Rp 5\.350\.000 \(dikembalikan ke karyawan\) dari upah sensus: TER, dan tarif Pasal 17 setahun untuk 1 karyawan yang berhenti bulan ini;/);
    // In July he is gone, and only Ani's TER remains.
    expect((await report(7)).ter).toMatchObject({ state: "CHECKED", leavers: [], estimate: 200_000n });
  });

  it("recomputes December under Pasal 17 less TER (PMK 168/2023), and names a lebih potong", async () => {
    await db.employee.create({ data: { firmId: g.firm.id, clientId: g.client.id, entityId: g.pt.entity.id, name: "Ani", sex: "FEMALE", birthDate: dateOnly(1990, 1, 1), hireDate: dateOnly(2020, 1, 1), wage: 10_000_000n, ptkpStatus: "TK0" } });
    await db.employee.create({ data: { firmId: g.firm.id, clientId: g.client.id, entityId: g.pt.entity.id, name: "Budi (keluar)", sex: "MALE", birthDate: dateOnly(1990, 1, 1), hireDate: dateOnly(2020, 1, 1), wage: 9_000_000n, ptkpStatus: "K1", leftOn: d(7, 31) } });
    // December's payroll withholds Ani's Pasal 17 balance: Rp 3 jt for the year less TER 2 % × 11 = Rp 800.000.
    await post(d(12, 25), [{ code: "6100", debit: 10_000_000n }, { code: "BANK", credit: 9_200_000n }, { code: "2140", credit: 800_000n }]);
    const dec = (await report(12, dateOnly(2027, 1, 5))).ter;
    expect(dec).toMatchObject({ state: "ANNUAL", estimate: 800_000n, booked: 800_000n, missing: 0, status: "PASS" });
    expect(dec.state === "ANNUAL" && dec.employees.map((e) => [e.name, e.months, e.pkp, e.annual, e.ter, e.december])).toEqual([["Ani", 12, 60_000_000n, 3_000_000n, 2_200_000n, 800_000n]]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await masaWorkbook(await report(12, dateOnly(2027, 1, 5)), { firm: "KJA Uji", title: "PT Uji" })) as unknown as ArrayBuffer);
    const cells = wb.getWorksheet("PPh 21 TER")!.getSheetValues().flat().map(String);
    expect(cells).toEqual(expect.arrayContaining(["PPh 21 Desember", "Ani", "TK/0", "Jumlah estimasi PPh 21 Desember"]));
    expect(terNote(dec)).toBe("Estimasi PPh 21 Desember Rp 800.000: PPh 21 setahun dengan tarif Pasal 17 dikurangi TER Januari–November, dari upah sensus; PPh 21 yang dicatat terutang Rp 800.000. Selisihnya dalam 10 %.");

    // Cici joined in July: six months, PKP Rp 3 jt → Rp 150.000 for the year, less TER Rp 1 jt → lebih potong Rp 850.000.
    await db.employee.create({ data: { firmId: g.firm.id, clientId: g.client.id, entityId: g.pt.entity.id, name: "Cici", sex: "FEMALE", birthDate: dateOnly(1995, 1, 1), hireDate: d(7, 1), wage: 10_000_000n, ptkpStatus: "TK0" } });
    const withCici = (await report(12, dateOnly(2027, 1, 5))).ter;
    expect(withCici).toMatchObject({ state: "ANNUAL", estimate: -50_000n, status: "REVIEW" });
    expect(withCici.state === "ANNUAL" && withCici.employees.find((e) => e.name === "Cici")).toMatchObject({ months: 6, december: -850_000n });
    expect(terNote(withCici)).toMatch(/^Estimasi PPh 21 Desember lebih potong Rp 50\.000 \(dikembalikan ke karyawan\)/);
  });

  it("flags PPh 21 remitted with nothing booked as withheld (payroll booked net)", async () => {
    await post(d(8, 10), [{ code: "2140", debit: 150_000n }, { code: "BANK", credit: 150_000n }]);
    const r = await row(8, "PPH_21");
    expect(r.netPayroll).toBe(true);
    expect(r.status).toBe("REVIEW");
    expect(rowNotes(r).join(" ")).toMatch(/Gaji mungkin dicatat neto/);
  });

  it("reads an opening balance as the masa before the books start, so its remittance is paid in full", async () => {
    await post(d(2, 28), [{ code: "2140", credit: 300n }, { code: "2130", credit: 900n }, { code: "3100", debit: 1_200n }], "OPENING");
    await post(d(3, 10), [{ code: "2140", debit: 300n }, { code: "BANK", credit: 300n }]);
    await post(d(3, 15), [{ code: "2130", debit: 900n }, { code: "BANK", credit: 900n }]);
    const pph = await row(3, "PPH_21");
    expect(pph.previous).toMatchObject({ owed: 300n, state: "LUNAS" });
    expect(pph).toMatchObject({ other: 0n, netPayroll: false, status: "PASS" });
    expect((await row(3, "PPN")).previous).toMatchObject({ owed: 900n, state: "LUNAS" });
  });

  it("names a PPh 23 payment made after the 15th as late, and an old opening balance apart", async () => {
    await post(d(1, 1), [{ code: "2141", credit: 40n }, { code: "3100", debit: 40n }], "OPENING");
    await post(d(7, 3), [{ code: "6190", debit: 5_000n }, { code: "BANK", credit: 4_900n }, { code: "2141", credit: 100n }]);
    await post(d(8, 20), [{ code: "2141", debit: 100n }, { code: "BANK", credit: 100n }]);
    const r = await row(8, "PPH_23");
    expect(r.previous).toMatchObject({ owed: 100n, state: "TERLAMBAT", short: 0n });
    expect(r.previous.late).toEqual([{ date: d(8, 20), amount: 100n }]);
    expect(r.other).toBe(40n);
    expect(rowNotes(r)).toEqual([
      "Masa Juli 2026: disetor setelah jatuh tempo 15 Agu 2026 (20 Agu 2026 Rp 100).",
      "Saldo 2141 memuat Rp 40 dari masa yang lebih lama (atau setoran yang belum tercatat).",
    ]);
  });
});

describe("Tutup Buku — Pajak masa disetor", () => {
  const control = async (month: number) => (await runControls(db, g.client.id, 2026, month)).find((c) => c.key === `masa:${g.pt.entity.id}`);

  it("is absent with no tax activity, flags a masa paid short, and passes once paid in full", async () => {
    expect(await control(8)).toBeUndefined();
    await post(d(7, 25), [{ code: "6100", debit: 10_000_000n }, { code: "BANK", credit: 9_800_000n }, { code: "2140", credit: 200_000n }]);
    await post(d(8, 10), [{ code: "2140", debit: 150_000n }, { code: "BANK", credit: 150_000n }]);
    const short = await control(8);
    expect(short).toMatchObject({ title: "Pajak masa disetor", status: "REVIEW" });
    expect(short!.detail).toMatch(/^PPh 21: Masa Juli 2026: Rp 50\.000 dari Rp 200\.000 belum disetor sampai jatuh tempo 15 Agu 2026/);
    expect(short!.href).toContain("/tax/masa?period=2026-08");
    await post(d(8, 14), [{ code: "2140", debit: 50_000n }, { code: "BANK", credit: 50_000n }]);
    expect(await control(8)).toMatchObject({ status: "PASS", detail: "Masa Juli 2026 disetor penuh sampai jatuh tempo; saldo PPh 21 sesuai yang masih terutang" });
  });

  it("does not call a masa before the Saldo Awal paid in full: Buku never saw it", async () => {
    // A Neraca per 31 August opened on August: July is before the books.
    await post(d(8, 31), [{ code: "BANK", debit: 300_000n }, { code: "2140", credit: 200_000n }, { code: "3200", credit: 100_000n }], "OPENING");
    expect(await control(8)).toMatchObject({ status: "PASS", detail: "Masa Juli 2026 sebelum pembukuan di Buku (mulai 31 Agu 2026): setorannya tidak bisa dicek di sini; saldo PPh 21 dari saldo awal" });
    // September judges August, whose payable the opening holds: unpaid by 15 September it is flagged like any other masa.
    expect((await control(9))?.detail).toMatch(/^PPh 21: Masa Agustus 2026: Rp 200\.000 dari Rp 200\.000 belum disetor/);
  });
});

describe("masaReport — bukti potong and TER states", () => {
  it("lists withholdings by the company and by its customers, with the contact's NPWP", async () => {
    const bank = g.pt.banks[0];
    const imp = await db.statementImport.create({ data: { firmId: g.firm.id, bankAccountId: bank.id, fileName: "bca.csv", format: "BCA", periodStart: d(8, 1), periodEnd: d(8, 31), openingBalance: 0n, closingBalance: 0n, rowCount: 2, continuityOk: true } });
    const vendor = await db.contact.create({ data: { firmId: g.firm.id, clientId: g.client.id, name: "CV Konsultan", npwp: "01.234.567.8-901.000" } });
    const base = { firmId: g.firm.id, importId: imp.id, bankAccountId: bank.id, entityId: g.pt.entity.id, merchantKey: "x", rawRow: "x", method: "MANUAL" as const, confidence: 1, reason: "uji" };
    await db.bankTransaction.create({ data: { ...base, date: d(8, 12), description: "JASA KONSULTAN", direction: "OUT", amount: -4_900_000n, rowNumber: 1, hash: "a", status: "REVIEWED", accountCode: "6200", whtKind: "PPH_23", whtAmount: 100_000n, contactId: vendor.id } });
    await db.bankTransaction.create({ data: { ...base, date: d(8, 14), description: "PELUNASAN PT PELANGGAN", direction: "IN", amount: 9_800_000n, rowNumber: 2, hash: "b", status: "NEEDS_REVIEW", accountCode: "1130", whtKind: "PPH_23", whtAmount: 200_000n } });
    // Payroll PPh 21 is not Unifikasi: e-Bupot 21/26, per employee.
    await db.bankTransaction.create({ data: { ...base, date: d(8, 25), description: "PAYROLL", direction: "OUT", amount: -9_800_000n, rowNumber: 3, hash: "c", status: "REVIEWED", accountCode: "6100", whtKind: "PPH_21", whtAmount: 200_000n } });
    const rep = await report(8);
    expect(rep.withheldByUs).toMatchObject([{ kind: "PPH_23", cash: 4_900_000n, withheld: 100_000n, gross: 5_000_000n, contact: { name: "CV Konsultan", npwp: "01.234.567.8-901.000" }, inReview: false }]);
    expect(rep.withheldFromUs).toMatchObject([{ kind: "PPH_23", cash: 9_800_000n, withheld: 200_000n, gross: 10_000_000n, contact: null, inReview: true }]);
  });

  it("says what the TER check needs when there is no census or no PTKP status", async () => {
    expect((await report(8)).ter).toEqual({ state: "NO_EMPLOYEES" });
    await db.employee.create({ data: { firmId: g.firm.id, clientId: g.client.id, entityId: g.pt.entity.id, name: "Ani", sex: "FEMALE", birthDate: dateOnly(1990, 1, 1), hireDate: dateOnly(2020, 1, 1), wage: 10_000_000n } });
    const t = (await report(8)).ter;
    expect(t).toEqual({ state: "NO_STATUS", missing: 1 });
    expect(terNote(t)).toMatch(/1 karyawan aktif belum punya status PTKP/);
  });
});

describe("masaWorkbook", () => {
  it("opens on Ringkasan with the rows, then Bukti Potong and PPh 21 TER", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { masaWorkbook } = await import("@/lib/tax/masa-workbook");
    await post(d(7, 25), [{ code: "6100", debit: 10_000_000n }, { code: "BANK", credit: 9_800_000n }, { code: "2140", credit: 200_000n }]);
    const buf = await masaWorkbook(await report(8), { firm: "KJA Uji", title: "PT Uji Sejahtera", draft: "bulan belum ditutup." });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Ringkasan", "Bukti Potong", "PPh 21 TER"]);
    const text = (name: string) => wb.getWorksheet(name)!.getSheetValues().flat().map(String).join(" | ");
    expect(text("Ringkasan")).toMatch(/PPh 21 \(2140\) \| 0 \| 15 Sep 2026 \| 200000 \| 0 \| 200000/);
    expect(text("Ringkasan")).toMatch(/Rp 200\.000 dari Rp 200\.000 belum disetor/);
    expect(text("Bukti Potong")).toMatch(/Tidak ada pemotongan oleh perusahaan masa ini/);
    expect(text("PPh 21 TER")).toMatch(/Tidak ada karyawan aktif di sensus/);
  });
});
