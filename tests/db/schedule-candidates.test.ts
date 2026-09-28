import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { scheduleCandidates } from "@/lib/adjust/candidates";
import { createSchedule } from "@/lib/adjust/schedules";
import { postJournal } from "@/lib/ledger/post";
import { dateOnly } from "@/lib/format";

const accountId = async (clientId: string, code: string) => (await db.account.findUniqueOrThrow({ where: { clientId_code: { clientId, code } } })).id;
const post = async (entityId: string, clientId: string, date: Date, dr: string, cr: string, amount: bigint, memo = "uji", kind: "ADJUSTMENT" | "OPENING" = "ADJUSTMENT") =>
  db.$transaction(async (tx) => postJournal(tx, { entityId, date, kind, memo, lines: [{ accountId: await accountId(clientId, dr), debit: amount }, { accountId: await accountId(clientId, cr), credit: amount }] }));

/** May–Jul: revenue 100 jt, utilities 5 jt, rent 3 jt, depreciation 1 jt a month → materiality Rp 1.090.000. */
async function books() {
  const g = await makeGroup();
  const pt = g.pt.entity.id;
  const c = g.client.id;
  for (const m of [5, 6, 7]) {
    await post(pt, c, dateOnly(2026, m, 10), "1130", "4100", 100_000_000n);
    await post(pt, c, dateOnly(2026, m, 20), "6130", "1130", 5_000_000n);
    await post(pt, c, dateOnly(2026, m, 25), "6120", "1130", 3_000_000n);
    await post(pt, c, dateOnly(2026, m, 28), "6180", "1219", 1_000_000n);
  }
  await post(pt, c, dateOnly(2026, 8, 10), "1130", "4100", 100_000_000n);
  await post(pt, c, dateOnly(2026, 8, 20), "6130", "1130", 5_000_000n); // utilities arrived; rent and depreciation didn't
  return { g, pt, c };
}

const summary = (xs: Awaited<ReturnType<typeof scheduleCandidates>>) => xs.map((x) => [x.kind, x.debitCode, x.creditCode, x.amount, x.months, `${x.startYear}-${x.startMonth}`]);

describe("schedule candidates from the ledger", () => {
  beforeEach(resetDb);

  it("proposes depreciation for a purchase, amortisation for a prepayment and deferred revenue, and accruals for missing costs", async () => {
    const { pt, c } = await books();
    const machine = await post(pt, c, dateOnly(2026, 8, 19), "1210", "2110", 48_000_000n, "Mesin pakan otomatis");
    await post(pt, c, dateOnly(2026, 8, 19), "1210", "3100", 30_000_000n, "Saldo awal kendaraan", "OPENING"); // an opening balance is not a purchase
    await post(pt, c, dateOnly(2026, 8, 21), "1210", "2110", 500_000n, "Kursi"); // below materiality
    await post(pt, c, dateOnly(2026, 8, 22), "1170", "2110", 12_000_000n, "Sewa gudang setahun");
    await post(pt, c, dateOnly(2026, 8, 23), "1130", "2160", 6_000_000n, "Kontrak jasa dibayar di muka");

    const found = await scheduleCandidates(db, c, 2026, 8);
    expect(summary(found)).toEqual([
      ["DEPRECIATION", "6180", "1219", 48_000_000n, 48, "2026-9"],
      ["AMORTIZATION", null, "1170", 12_000_000n, 12, "2026-9"],
      ["AMORTIZATION", "2160", "4110", 6_000_000n, 12, "2026-9"],
      ["ACCRUAL", "6120", "2150", 3_000_000n, 1, "2026-8"],
      // depreciation (1 jt a month, missing too) is below materiality Rp 1.090.000
    ]);
    expect(found[0]).toMatchObject({ sourceEntryId: machine.id, reason: "Pembelian 1210 Aset Tetap 19 Agu 2026: Mesin pakan otomatis", memo: "Penyusutan 1210 Aset Tetap 19 Agu 2026" });
    expect(found[3].reason).toBe("6120 Beban Sewa tercatat tiap bulan (2026-05, 2026-06, 2026-07), bulan ini belum");
  });

  it("drops a candidate once a schedule cites its entry, and skips accounts a running schedule covers", async () => {
    const { pt, c } = await books();
    const machine = await post(pt, c, dateOnly(2026, 8, 19), "1210", "2110", 48_000_000n, "Mesin pakan otomatis");
    await createSchedule(db, { clientId: c, entityId: pt, kind: "DEPRECIATION", memo: "Penyusutan mesin", debitCode: "6180", creditCode: "1219", amount: "48.000.000", months: 48, startYear: 2026, startMonth: 9, sourceEntryId: machine.id });
    await createSchedule(db, { clientId: c, entityId: pt, kind: "AMORTIZATION", memo: "Sewa kantor", debitCode: "6120", creditCode: "1170", amount: "36.000.000", months: 12, startYear: 2026, startMonth: 8 });
    expect(summary(await scheduleCandidates(db, c, 2026, 8))).toEqual([]);
  });

  it("a schedule made from a compound entry covers only its own line; the entry's other lines stay proposed", async () => {
    const { g, pt, c } = await books();
    const vehicles = await db.account.create({ data: { firmId: g.firm.id, clientId: c, code: "1211", name: "Kendaraan", type: "ASET", normalBalance: "DEBIT", fsLine: "ASET_TETAP" } });
    const acc = (code: string) => accountId(c, code);
    // One purchase of two fixed assets, and one invoice with a prepayment and a fixed asset.
    const buy = await db.$transaction(async (tx) => postJournal(tx, { entityId: pt, date: dateOnly(2026, 8, 19), kind: "ADJUSTMENT", memo: "Mesin dan mobil", lines: [{ accountId: await acc("1210"), debit: 48_000_000n }, { accountId: vehicles.id, debit: 30_000_000n }, { accountId: await acc("2110"), credit: 78_000_000n }] }));
    const mixed = await db.$transaction(async (tx) => postJournal(tx, { entityId: pt, date: dateOnly(2026, 8, 22), kind: "ADJUSTMENT", memo: "Sewa dan rak", lines: [{ accountId: await acc("1170"), debit: 12_000_000n }, { accountId: await acc("1210"), debit: 20_000_000n }, { accountId: await acc("2110"), credit: 32_000_000n }] }));
    // Two fixed assets of the same amount on one entry: one schedule covers one of them, never both.
    // The second asset's name is long: its memo is cut at 80 characters, but the account code at the front survives.
    const long = await db.account.create({ data: { firmId: g.firm.id, clientId: c, code: "1212", name: "Peralatan Kantor dan Perlengkapan Cetak Digital Kapasitas Besar untuk Gudang Pusat", type: "ASET", normalBalance: "DEBIT", fsLine: "ASET_TETAP" } });
    const twin = await db.$transaction(async (tx) => postJournal(tx, { entityId: pt, date: dateOnly(2026, 8, 24), kind: "ADJUSTMENT", memo: "Dua printer", lines: [{ accountId: await acc("1210"), debit: 15_000_000n }, { accountId: long.id, debit: 15_000_000n }, { accountId: await acc("2110"), credit: 30_000_000n }] }));
    const name = (id: string | null) => (id === buy.id ? "buy" : id === mixed.id ? "mixed" : "twin");
    const pending = async () => (await scheduleCandidates(db, c, 2026, 8)).filter((x) => x.kind !== "ACCRUAL" && name(x.sourceEntryId) !== "twin").map((x) => `${x.kind}:${name(x.sourceEntryId)}:${x.amount}`);
    const twins = async () => (await scheduleCandidates(db, c, 2026, 8)).filter((x) => x.sourceEntryId === twin.id);
    const [, second] = await twins();
    expect([(await twins()).length, second.memo.length, second.memo.startsWith("Penyusutan 1212 ")]).toEqual([2, 80, true]);
    // Scheduling the second candidate (its memo carries 1212) leaves the first one, never the other way round.
    await createSchedule(db, { clientId: c, entityId: pt, kind: "DEPRECIATION", memo: second.memo, debitCode: "6180", creditCode: "1219", amount: "15.000.000", months: 36, startYear: 2026, startMonth: 9, sourceEntryId: twin.id });
    expect((await twins()).map((x) => x.memo)).toEqual(["Penyusutan 1210 Aset Tetap 24 Agu 2026"]);
    expect(await pending()).toEqual(["DEPRECIATION:buy:48000000", "DEPRECIATION:buy:30000000", "AMORTIZATION:mixed:12000000", "DEPRECIATION:mixed:20000000"]);

    // A schedule with the prepaid account on the debit side grows the prepayment instead of releasing it: it covers nothing.
    await createSchedule(db, { clientId: c, entityId: pt, kind: "AMORTIZATION", memo: "Salah sisi", debitCode: "1170", creditCode: "2110", amount: "12.000.000", months: 12, startYear: 2026, startMonth: 9, sourceEntryId: mixed.id });
    expect(await pending()).toContain("AMORTIZATION:mixed:12000000");
    // Depreciating the machine leaves the car; amortising the rent leaves the rack.
    await createSchedule(db, { clientId: c, entityId: pt, kind: "DEPRECIATION", memo: "Penyusutan mesin", debitCode: "6180", creditCode: "1219", amount: "48.000.000", months: 48, startYear: 2026, startMonth: 9, sourceEntryId: buy.id });
    await createSchedule(db, { clientId: c, entityId: pt, kind: "AMORTIZATION", memo: "Sewa", debitCode: "6120", creditCode: "1170", amount: "12.000.000", months: 12, startYear: 2026, startMonth: 9, sourceEntryId: mixed.id });
    expect(await pending()).toEqual(["DEPRECIATION:buy:30000000", "DEPRECIATION:mixed:20000000"]);
    // A depreciation created with an edited amount (residual value) still counts when its memo carries the asset's code.
    await createSchedule(db, { clientId: c, entityId: pt, kind: "DEPRECIATION", memo: "Penyusutan 1211 mobil", debitCode: "6180", creditCode: "1219", amount: "25.000.000", months: 60, startYear: 2026, startMonth: 9, sourceEntryId: buy.id });
    expect(await pending()).toEqual(["DEPRECIATION:mixed:20000000"]);
    // A prepayment candidate turned into a depreciation (its memo and amount name no asset line) hides no asset line.
    await createSchedule(db, { clientId: c, entityId: pt, kind: "DEPRECIATION", memo: "Amortisasi Uang Muka & Biaya Dibayar di Muka 22 Agu 2026", debitCode: "6180", creditCode: "1219", amount: "12.000.000", months: 12, startYear: 2026, startMonth: 9, sourceEntryId: mixed.id });
    expect(await pending()).toEqual(["DEPRECIATION:mixed:20000000"]);
  });

  it("an older depreciation with a custom memo and an adjusted amount still covers its entry's only asset line", async () => {
    const { pt, c } = await books();
    const machine = await post(pt, c, dateOnly(2026, 8, 19), "1210", "2110", 48_000_000n, "Mesin pakan otomatis");
    await createSchedule(db, { clientId: c, entityId: pt, kind: "DEPRECIATION", memo: "Susut mesin pakan (nilai sisa 8 jt)", debitCode: "6180", creditCode: "1219", amount: "40.000.000", months: 48, startYear: 2026, startMonth: 9, sourceEntryId: machine.id });
    expect((await scheduleCandidates(db, c, 2026, 8)).filter((x) => x.sourceEntryId === machine.id)).toEqual([]);
  });

  it("drops an accrual candidate once that month's accrual is created", async () => {
    const { pt, c } = await books();
    await createSchedule(db, { clientId: c, entityId: pt, kind: "ACCRUAL", memo: "Akrual sewa Agustus", debitCode: "6120", creditCode: "2150", amount: "3.000.000", months: 1, startYear: 2026, startMonth: 8 });
    expect((await scheduleCandidates(db, c, 2026, 8)).filter((x) => x.kind === "ACCRUAL")).toEqual([]);
  });

  it("needs three baseline months before proposing an accrual", async () => {
    const g = await makeGroup();
    const pt = g.pt.entity.id;
    const c = g.client.id;
    for (const m of [6, 7]) {
      await post(pt, c, dateOnly(2026, m, 10), "1130", "4100", 100_000_000n);
      await post(pt, c, dateOnly(2026, m, 25), "6120", "1130", 3_000_000n);
    }
    await post(pt, c, dateOnly(2026, 8, 10), "1130", "4100", 100_000_000n);
    expect(await scheduleCandidates(db, c, 2026, 8)).toEqual([]);
  });

  it("a finished schedule no longer covers its account: a missing rent is proposed as an accrual again", async () => {
    const { pt, c } = await books();
    await createSchedule(db, { clientId: c, entityId: pt, kind: "AMORTIZATION", memo: "Sewa kantor Mar–Mei", debitCode: "6120", creditCode: "1170", amount: "9.000.000", months: 3, startYear: 2026, startMonth: 3 });
    expect(summary(await scheduleCandidates(db, c, 2026, 8))).toEqual([["ACCRUAL", "6120", "2150", 3_000_000n, 1, "2026-8"]]);
  });
});

