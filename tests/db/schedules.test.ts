import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { createSchedule, dueProposals, installments, listSchedules, postAllDue, postInstallment, stopSchedule } from "@/lib/adjust/schedules";
import { dateOnly } from "@/lib/format";

describe("adjustment schedules", () => {
  beforeEach(resetDb);

  it("splits the total exactly, the last installment taking the remainder, across a year end", () => {
    const i = installments({ amount: 100n, months: 3, startYear: 2026, startMonth: 11, reverse: false, debitAccountId: "d", creditAccountId: "c" });
    expect(i.map((x) => [x.k, x.year, x.month, x.date.toISOString().slice(0, 10), x.amount])).toEqual([
      [1, 2026, 11, "2026-11-30", 33n],
      [2, 2026, 12, "2026-12-31", 33n],
      [3, 2027, 1, "2027-01-31", 34n],
    ]);
    expect(i.reduce((s, x) => s + x.amount, 0n)).toBe(100n);
  });

  it("an accrual is one month and reverses on the 1st of the next, sides swapped", async () => {
    const g = await makeGroup();
    const s = await createSchedule(db, { clientId: g.client.id, entityId: g.pt.entity.id, kind: "ACCRUAL", memo: "Akrual listrik Agustus", debitCode: "6130", creditCode: "2150", amount: "4.500.000", months: 12, startYear: 2026, startMonth: 8 });
    expect([s.months, s.reverse, s.amount]).toEqual([1, true, 4_500_000n]);
    const i = installments(s);
    expect(i.map((x) => [x.k, x.date.toISOString().slice(0, 10), x.reversal, x.debitAccountId === s.debitAccountId])).toEqual([
      [1, "2026-08-31", false, true],
      [2, "2026-09-01", true, false],
    ]);
    await postInstallment(db, { clientId: g.client.id, scheduleId: s.id, k: 1 });
    const [sep] = await dueProposals(db, g.client.id, 2026, 9);
    expect(sep.memo).toBe("Pembalikan: Akrual listrik Agustus");
  });

  it("refuses the same account twice, bank or suspense accounts, a zero amount and zero months", async () => {
    const g = await makeGroup();
    const base = { clientId: g.client.id, entityId: g.pt.entity.id, kind: "DEPRECIATION" as const, memo: "Penyusutan", debitCode: "6180", creditCode: "1219", amount: "1.200.000", months: 12, startYear: 2026, startMonth: 9 };
    await expect(createSchedule(db, { ...base, creditCode: "6180" })).rejects.toThrow("harus berbeda");
    await expect(createSchedule(db, { ...base, creditCode: "1999" })).rejects.toThrow("tidak memakai akun bank");
    const bank = await db.account.findFirstOrThrow({ where: { clientId: g.client.id, isBank: true } });
    await expect(createSchedule(db, { ...base, creditCode: bank.code })).rejects.toThrow("tidak memakai akun bank");
    await expect(createSchedule(db, { ...base, amount: "0" })).rejects.toThrow("lebih dari nol");
    await expect(createSchedule(db, { ...base, months: 0 })).rejects.toThrow("Jumlah bulan");
    await expect(createSchedule(db, { ...base, entityId: "bukan" })).rejects.toThrow("Pilih entitas");
  });

  it("proposes the month's installment, posts it once even when clicked twice, and tracks progress", async () => {
    const g = await makeGroup();
    const s = await createSchedule(db, { clientId: g.client.id, entityId: g.pt.entity.id, kind: "DEPRECIATION", memo: "Penyusutan mesin pakan", debitCode: "6180", creditCode: "1219", amount: "166.666.667", months: 48, startYear: 2026, startMonth: 9 });
    expect(await dueProposals(db, g.client.id, 2026, 8)).toEqual([]);
    const [p] = await dueProposals(db, g.client.id, 2026, 9);
    expect([p.memo, p.installment.amount, p.schedule.debitAccount.code]).toEqual(["Penyusutan mesin pakan (1/48)", 3_472_222n, "6180"]);

    const results = await Promise.allSettled([1, 2].map(() => postInstallment(db, { clientId: g.client.id, scheduleId: s.id, k: 1 })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const entries = await db.journalEntry.findMany({ where: { scheduleId: s.id }, include: { lines: true } });
    expect(entries.map((e) => [e.kind, e.installment, e.date.toISOString().slice(0, 10), e.lines.map((l) => l.debit + l.credit)])).toEqual([["ADJUSTMENT", 1, "2026-09-30", [3_472_222n, 3_472_222n]]]);
    await expect(postInstallment(db, { clientId: g.client.id, scheduleId: s.id, k: 1 })).rejects.toThrow("sudah dicatat");
    expect(await dueProposals(db, g.client.id, 2026, 9)).toEqual([]);

    const [row] = await listSchedules(db, g.client.id);
    expect([row.postedCount, row.postedAmount, row.remaining, row.ends]).toEqual([1, 3_472_222n, 166_666_667n - 3_472_222n, { year: 2030, month: 8 }]);
    expect(installments(s).at(-1)!.amount).toBe(166_666_667n - 3_472_222n * 47n);
  });

  it("posts every due installment of a month, refuses a locked month, and stops proposing after a stop", async () => {
    const g = await makeGroup();
    const input = { clientId: g.client.id, entityId: g.pt.entity.id, debitCode: "6120", creditCode: "1170", months: 12, startYear: 2026, startMonth: 8 };
    const rent = await createSchedule(db, { ...input, kind: "AMORTIZATION", memo: "Sewa gudang dibayar di muka", amount: "24.000.000" });
    await createSchedule(db, { ...input, kind: "DEPRECIATION", memo: "Penyusutan kendaraan", debitCode: "6180", creditCode: "1219", amount: "60.000.000", months: 60 });
    expect(await postAllDue(db, { clientId: g.client.id, year: 2026, month: 8 })).toBe(2);
    await expect(postAllDue(db, { clientId: g.client.id, year: 2026, month: 8 })).rejects.toThrow("Tidak ada jurnal terjadwal");

    await db.period.upsert({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month: 9 } }, create: { firmId: g.firm.id, clientId: g.client.id, year: 2026, month: 9, status: "LOCKED" }, update: { status: "LOCKED" } });
    await expect(postInstallment(db, { clientId: g.client.id, scheduleId: rent.id, k: 2 })).rejects.toThrow("sudah ditutup");

    await stopSchedule(db, { clientId: g.client.id, scheduleId: rent.id });
    expect((await dueProposals(db, g.client.id, 2026, 10)).map((p) => p.schedule.memo)).toEqual(["Penyusutan kendaraan"]);
    await expect(postInstallment(db, { clientId: g.client.id, scheduleId: rent.id, k: 3 })).rejects.toThrow("sudah dihentikan");
    expect(await db.journalEntry.count({ where: { scheduleId: rent.id } })).toBe(1); // what was posted stays
  });

  it("keeps the source entry it came from and never reaches another client's schedule", async () => {
    const g = await makeGroup();
    const other = await makeGroup();
    const buy = await db.$transaction(async (tx) => {
      const acc = async (code: string) => (await tx.account.findUniqueOrThrow({ where: { clientId_code: { clientId: g.client.id, code } } })).id;
      const { postJournal } = await import("@/lib/ledger/post");
      return postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 8, 19), kind: "ADJUSTMENT", memo: "Beli mesin", lines: [{ accountId: await acc("1210"), debit: 48_000_000n }, { accountId: await acc("2110"), credit: 48_000_000n }] });
    });
    const s = await createSchedule(db, { clientId: g.client.id, entityId: g.pt.entity.id, kind: "DEPRECIATION", memo: "Penyusutan mesin", debitCode: "6180", creditCode: "1219", amount: "48.000.000", months: 48, startYear: 2026, startMonth: 9, sourceEntryId: buy.id });
    expect(s.sourceEntryId).toBe(buy.id);
    await expect(createSchedule(db, { clientId: g.client.id, entityId: g.owner.entity.id, kind: "DEPRECIATION", memo: "x", debitCode: "6180", creditCode: "1219", amount: "1", months: 1, startYear: 2026, startMonth: 9, sourceEntryId: buy.id })).rejects.toThrow("Jurnal sumber");
    await expect(postInstallment(db, { clientId: other.client.id, scheduleId: s.id, k: 1 })).rejects.toThrow("Jadwal tidak ditemukan");
    await expect(stopSchedule(db, { clientId: other.client.id, scheduleId: s.id })).rejects.toThrow("Jadwal tidak ditemukan");
  });
});
