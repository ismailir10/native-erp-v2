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
    expect(found[0]).toMatchObject({ sourceEntryId: machine.id, reason: "Pembelian 1210 Aset Tetap 19 Agu 2026: Mesin pakan otomatis", memo: "Penyusutan Mesin pakan otomatis" });
    expect(found[3].reason).toBe("6120 Beban Sewa tercatat tiap bulan (2026-05, 2026-06, 2026-07), bulan ini belum");
  });

  it("drops a candidate once a schedule cites its entry, and skips accounts a running schedule covers", async () => {
    const { pt, c } = await books();
    const machine = await post(pt, c, dateOnly(2026, 8, 19), "1210", "2110", 48_000_000n, "Mesin pakan otomatis");
    await createSchedule(db, { clientId: c, entityId: pt, kind: "DEPRECIATION", memo: "Penyusutan mesin", debitCode: "6180", creditCode: "1219", amount: "48.000.000", months: 48, startYear: 2026, startMonth: 9, sourceEntryId: machine.id });
    await createSchedule(db, { clientId: c, entityId: pt, kind: "AMORTIZATION", memo: "Sewa kantor", debitCode: "6120", creditCode: "1170", amount: "36.000.000", months: 12, startYear: 2026, startMonth: 8 });
    expect(summary(await scheduleCandidates(db, c, 2026, 8))).toEqual([]);
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
});
