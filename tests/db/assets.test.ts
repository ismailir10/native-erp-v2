import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { postOpening } from "@/lib/opening";
import { createSchedule, postInstallment } from "@/lib/adjust/schedules";
import { assetCandidates, assetDetail, assetRegister, createAsset, registerVsLedger, unregisteredSchedules } from "@/lib/assets/register";
import { dateOnly } from "@/lib/format";
import { runControls } from "@/lib/controls";

type G = Awaited<ReturnType<typeof makeGroup>>;
const acc = async (g: G, code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;

async function purchase(g: G, amount: bigint, date = dateOnly(2026, 8, 10), memo = "Pembelian laptop") {
  return db.$transaction(async (tx) =>
    postJournal(tx, { entityId: g.pt.entity.id, date, kind: "ADJUSTMENT", memo, lines: [{ accountId: await acc(g, "1210"), debit: amount }, { accountId: await acc(g, "2110"), credit: amount }] }),
  );
}

const base = (g: G) => ({ clientId: g.client.id, entityId: g.pt.entity.id, taxGroup: "KELOMPOK_1" as const, fiscalMethod: "GARIS_LURUS" as const, assetAccountCode: "1210" });

describe("fixed-asset register", () => {
  beforeEach(resetDb);

  it("registers a purchase line with its schedule, and the line stops being a candidate", async () => {
    const g = await makeGroup();
    const entry = await purchase(g, 48_000_000n);
    expect((await assetCandidates(db, g.client.id)).map((c) => [c.entryId, c.amount, c.account.code])).toEqual([[entry.id, 48_000_000n, "1210"]]);
    await expect(createAsset(db, { ...base(g), name: "Laptop", acquiredOn: "2026-08-10", cost: "40000000", sourceEntryId: entry.id })).rejects.toThrow(/sama dengan nilai pembelian/);

    const asset = await createAsset(db, { ...base(g), name: "Laptop kantor", acquiredOn: "2026-08-10", cost: "48000000", sourceEntryId: entry.id });
    const s = await db.adjustmentSchedule.findUniqueOrThrow({ where: { id: asset.scheduleId! } });
    expect(s).toMatchObject({ kind: "DEPRECIATION", amount: 48_000_000n, months: 48, startYear: 2026, startMonth: 9, sourceEntryId: entry.id, memo: "Penyusutan Laptop kantor" });
    expect(asset.usefulLifeMonths).toBe(48);
    expect(await assetCandidates(db, g.client.id)).toEqual([]);
    await expect(createAsset(db, { ...base(g), name: "Lagi", acquiredOn: "2026-08-10", cost: "48000000", sourceEntryId: entry.id })).rejects.toThrow(/sudah terdaftar/);

    // August: nothing booked yet; the fiscal estimate starts in the month of acquisition (48 jt ÷ 48 = 1 jt).
    let [row] = await assetRegister(db, g.client.id, 2026, 8);
    expect(row).toMatchObject({ cost: 48_000_000n, accumulated: 0n, bookValue: 48_000_000n, bookYtd: 0n, fiscalYtd: 1_000_000n, difference: -1_000_000n, unposted: 0 });
    await postInstallment(db, { clientId: g.client.id, scheduleId: s.id, k: 1 });
    [row] = await assetRegister(db, g.client.id, 2026, 9);
    expect(row).toMatchObject({ accumulated: 1_000_000n, bookValue: 47_000_000n, bookYtd: 1_000_000n, fiscalYtd: 2_000_000n, difference: -1_000_000n, unposted: 0 });
    [row] = await assetRegister(db, g.client.id, 2026, 10);
    expect(row.unposted).toBe(1);
    expect(await registerVsLedger(db, g.client.id, 2026, 9)).toMatchObject([{ register: { cost: 48_000_000n, accumulated: 1_000_000n }, ledger: { cost: 48_000_000n, accumulated: 1_000_000n }, equal: true }]);
    // The drill behind those figures: the purchase line, then the installment, each on its ledger month.
    const detail = await assetDetail(db, g.client.id, asset.id);
    expect(detail?.moves.map((m) => [m.kind, m.cost, m.accumulated, m.entryId, m.ledger])).toEqual([
      ["ACQUIRED", 48_000_000n, 0n, entry.id, { code: "1210", year: 2026, month: 8 }],
      ["DEPRECIATION", 0n, 1_000_000n, expect.any(String), { code: "1219", year: 2026, month: 9 }],
    ]);
  });

  it("registers Saldo Awal assets by hand: the remaining value over the remaining life, or none when fully depreciated", async () => {
    const g = await makeGroup();
    await postOpening(db, { clientId: g.client.id, entityId: g.pt.entity.id, date: dateOnly(2025, 12, 31), lines: [{ accountCode: "1210", debit: "130000000", credit: "0" }, { accountCode: "1219", debit: "0", credit: "70000000" }] });
    await expect(createAsset(db, { ...base(g), name: "Mobil", taxGroup: "KELOMPOK_2", acquiredOn: "2023-01-10", cost: "100000000", openingAccumulated: "40000000", usefulLifeMonths: 96 })).rejects.toThrow(/sisa masa manfaat/);
    const car = await createAsset(db, { ...base(g), name: "Mobil box", taxGroup: "KELOMPOK_2", acquiredOn: "2023-01-10", cost: "100000000", openingAccumulated: "40000000", usefulLifeMonths: 96, remainingMonths: 60, startYear: 2026, startMonth: 1 });
    expect(await db.adjustmentSchedule.findUniqueOrThrow({ where: { id: car.scheduleId! } })).toMatchObject({ amount: 60_000_000n, months: 60, startYear: 2026, startMonth: 1 });
    const old = await createAsset(db, { ...base(g), name: "Printer lama", acquiredOn: "2020-01-10", cost: "30000000", openingAccumulated: "30000000" });
    expect(old.scheduleId).toBeNull();
    const rows = await assetRegister(db, g.client.id, 2026, 1);
    expect(rows.map((r) => [r.name, r.cost, r.accumulated, r.bookValue, r.unposted])).toEqual([
      ["Printer lama", 30_000_000n, 30_000_000n, 0n, 0],
      ["Mobil box", 100_000_000n, 40_000_000n, 60_000_000n, 1],
    ]);
    expect((await registerVsLedger(db, g.client.id, 2026, 1))[0]).toMatchObject({ equal: true, ledger: { cost: 130_000_000n, accumulated: 70_000_000n } });
    // The fiscal side runs from the acquisition date: Kelompok 2 straight line, 12,5 jt a year, January = its twelfth (rounded down).
    expect(rows[1].fiscalYtd).toBe(1_041_666n);
    expect((await assetRegister(db, g.client.id, 2026, 12))[1].fiscalYtd).toBe(12_500_000n);
  });

  it("turns an existing depreciation schedule into an asset, only for the amount it depreciates", async () => {
    const g = await makeGroup();
    const s = await createSchedule(db, { clientId: g.client.id, entityId: g.pt.entity.id, kind: "DEPRECIATION", memo: "Penyusutan mesin", debitCode: "6180", creditCode: "1219", amount: "12000000", months: 12, startYear: 2026, startMonth: 9 });
    expect((await unregisteredSchedules(db, g.client.id)).map((x) => x.id)).toEqual([s.id]);
    await expect(createAsset(db, { ...base(g), name: "Mesin", acquiredOn: "2026-08-01", cost: "15000000", scheduleId: s.id })).rejects.toThrow(/total jadwal/);
    const asset = await createAsset(db, { ...base(g), name: "Mesin jahit", acquiredOn: "2026-08-01", cost: "12000000", scheduleId: s.id });
    expect(asset).toMatchObject({ scheduleId: s.id, usefulLifeMonths: 12 });
    expect(await unregisteredSchedules(db, g.client.id)).toEqual([]);
    await expect(createAsset(db, { ...base(g), name: "Dua kali", acquiredOn: "2026-08-01", cost: "12000000", scheduleId: s.id })).rejects.toThrow(/sudah menjadi aset/);
  });

  it("keeps land without depreciation and refuses what the rules don't allow", async () => {
    const g = await makeGroup();
    const land = await createAsset(db, { ...base(g), name: "Tanah gudang", taxGroup: "TANAH", acquiredOn: "2026-02-01", cost: "500000000" });
    expect(land).toMatchObject({ scheduleId: null, usefulLifeMonths: null, accumulatedAccountId: null });
    const [row] = await assetRegister(db, g.client.id, 2026, 12);
    expect(row).toMatchObject({ accumulated: 0n, fiscalYtd: 0n, difference: 0n });
    await expect(createAsset(db, { ...base(g), name: "Gudang", taxGroup: "BANGUNAN_PERMANEN", fiscalMethod: "SALDO_MENURUN", acquiredOn: "2026-02-01", cost: "1000" })).rejects.toThrow(/garis lurus/);
    await expect(createAsset(db, { ...base(g), name: "X", acquiredOn: "2026-02-01", cost: "1000", residual: "1000" })).rejects.toThrow(/Nilai sisa/);
    await expect(createAsset(db, { ...base(g), name: "X", acquiredOn: "2026-02-30", cost: "1000" })).rejects.toThrow(/Tanggal perolehan/);
    await expect(createAsset(db, { ...base(g), name: "X", acquiredOn: "2026-02-01", cost: "1000", assetAccountCode: "6180" })).rejects.toThrow(/akun aset tetap/);
  });
});

describe("fixed-asset close control", () => {
  beforeEach(resetDb);

  it("passes when the register equals the ledger and asks for a note when a typed journal moves the asset account", async () => {
    const g = await makeGroup();
    const control = async (month: number) => (await runControls(db, g.client.id, 2026, month)).find((c) => c.key === `fa:${g.pt.entity.id}`);
    expect(await control(8)).toBeUndefined(); // no register, no control
    const entry = await purchase(g, 48_000_000n);
    await createAsset(db, { ...base(g), name: "Laptop kantor", acquiredOn: "2026-08-10", cost: "48000000", sourceEntryId: entry.id });
    expect(await control(8)).toMatchObject({ status: "PASS", detail: "Harga perolehan Rp 48.000.000, akumulasi penyusutan Rp 0" });
    await purchase(g, 5_000_000n, dateOnly(2026, 8, 20), "Kursi, belum didaftarkan");
    const c = await control(8);
    expect(c?.status).toBe("REVIEW");
    expect(c?.detail).toMatch(/^Harga perolehan: daftar Rp 48\.000\.000 vs buku besar Rp 53\.000\.000 \(1210\)/);
    expect(c?.href).toBe(`/clients/${g.client.id}/assets?period=2026-08&entity=${g.pt.entity.id}`);
  });
});

describe("fixed-asset register guards", () => {
  beforeEach(resetDb);

  it("refuses an asset that would enter a locked month's register, on every path", async () => {
    const g = await makeGroup();
    const entry = await purchase(g, 48_000_000n);
    await db.period.update({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month: 8 } }, data: { status: "LOCKED" } });
    await expect(createAsset(db, { ...base(g), name: "Tanah", taxGroup: "TANAH", acquiredOn: "2026-08-02", cost: "1000" })).rejects.toThrow(/Agustus 2026 sudah dikunci/);
    await expect(createAsset(db, { ...base(g), name: "Laptop", acquiredOn: "2026-08-10", cost: "48000000", sourceEntryId: entry.id })).rejects.toThrow(/Agustus 2026 sudah dikunci/);
    expect(await db.fixedAsset.count()).toBe(0);
    expect(await db.adjustmentSchedule.count()).toBe(0); // the schedule rolled back with it
    // A later locked month counts too: the asset would enter September's register as well.
    await db.period.update({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month: 8 } }, data: { status: "OPEN" } });
    await db.period.create({ data: { firmId: g.firm.id, clientId: g.client.id, year: 2026, month: 9, status: "LOCKED" } });
    await expect(createAsset(db, { ...base(g), name: "Tanah", taxGroup: "TANAH", acquiredOn: "2026-08-02", cost: "1000" })).rejects.toThrow(/September 2026 sudah dikunci/);
    expect(await db.fixedAsset.count()).toBe(0);
  });

  it("counts opening accumulation only from the opening date and never starts depreciation before it or before acquisition", async () => {
    const g = await makeGroup();
    await expect(createAsset(db, { ...base(g), name: "Mobil", taxGroup: "KELOMPOK_2", acquiredOn: "2023-01-10", cost: "100000000", openingAccumulated: "40000000", usefulLifeMonths: 96, remainingMonths: 60 })).rejects.toThrow(/catat Saldo Awal/);
    await postOpening(db, { clientId: g.client.id, entityId: g.pt.entity.id, date: dateOnly(2025, 12, 31), lines: [{ accountCode: "1210", debit: "100000000", credit: "0" }, { accountCode: "1219", debit: "0", credit: "40000000" }] });
    const car = { ...base(g), name: "Mobil", taxGroup: "KELOMPOK_2" as const, acquiredOn: "2023-01-10", cost: "100000000", openingAccumulated: "40000000", usefulLifeMonths: 96, remainingMonths: 60 };
    await expect(createAsset(db, { ...car, startYear: 2025, startMonth: 12 })).rejects.toThrow(/sesudah bulan Saldo Awal/);
    const a = await createAsset(db, car);
    expect(await db.adjustmentSchedule.findUniqueOrThrow({ where: { id: a.scheduleId! } })).toMatchObject({ startYear: 2026, startMonth: 1 });
    // Before the books started there is no register (and no GL): nothing listed for November 2025.
    expect(await assetRegister(db, g.client.id, 2025, 11)).toEqual([]);
    expect((await assetRegister(db, g.client.id, 2025, 12))[0]).toMatchObject({ accumulated: 40_000_000n, bookValue: 60_000_000n });
    await expect(createAsset(db, { ...base(g), name: "Printer", acquiredOn: "2026-03-10", cost: "4800000", startYear: 2026, startMonth: 2 })).rejects.toThrow(/sebelum bulan perolehan/);
  });
});
