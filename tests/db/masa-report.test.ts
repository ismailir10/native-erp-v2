import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { dateOnly } from "@/lib/format";
import { masaReport, rowNotes, terNote } from "@/lib/tax/masa-report";
import { runControls } from "@/lib/controls";

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
    expect(r.ppn).toEqual({ keluaran: 2_200n, masukan: 0n, carryIn: 0n, carryOut: 0n });
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
    expect(terNote((await report(12)).ter)).toMatch(/Desember dihitung ulang dengan tarif Pasal 17/);
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
