import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { postInstallment } from "@/lib/adjust/schedules";
import { assetRegister, createAsset, registerVsLedger } from "@/lib/assets/register";
import { disposeAsset } from "@/lib/assets/dispose";
import { dateOnly } from "@/lib/format";

type G = Awaited<ReturnType<typeof makeGroup>>;
const acc = async (g: G, code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;

/** A 12-jt machine bought 10 Aug 2026, depreciated over 12 months from September (1 jt a month). */
async function machine(g: G) {
  const entry = await db.$transaction(async (tx) =>
    postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 8, 10), kind: "ADJUSTMENT", memo: "Beli mesin", lines: [{ accountId: await acc(g, "1210"), debit: 12_000_000n }, { accountId: await acc(g, "2110"), credit: 12_000_000n }] }),
  );
  return createAsset(db, { clientId: g.client.id, entityId: g.pt.entity.id, name: "Mesin jahit", taxGroup: "KELOMPOK_1", fiscalMethod: "GARIS_LURUS", acquiredOn: "2026-08-10", cost: "12000000", usefulLifeMonths: 12, assetAccountCode: "1210", sourceEntryId: entry.id });
}
const post = (g: G, scheduleId: string, ...ks: number[]) => Promise.all(ks.map((k) => postInstallment(db, { clientId: g.client.id, scheduleId, k })));
const lines = async (entryId: string) =>
  (await db.journalLine.findMany({ where: { entryId }, include: { account: true }, orderBy: { id: "asc" } })).map((l) => [l.account.code, l.debit, l.credit]);

describe("fixed-asset disposal", () => {
  beforeEach(resetDb);

  it("sells at a gain: accumulated off, asset off at cost, gain on 7300; the schedule stops and the register drops it", async () => {
    const g = await makeGroup();
    const a = await machine(g);
    await expect(disposeAsset(db, { clientId: g.client.id, assetId: a.id, date: "2026-10-20", proceeds: "11000000", proceedsCode: "1140" })).rejects.toThrow(/Catat dulu penyusutan Mesin jahit sampai Oktober 2026 \(2 angsuran\)/);
    await post(g, a.scheduleId!, 1, 2);
    const r = await disposeAsset(db, { clientId: g.client.id, assetId: a.id, date: "2026-10-20", proceeds: "11000000", proceedsCode: "1140" });
    expect(r).toMatchObject({ accumulated: 2_000_000n, bookValue: 10_000_000n, result: 1_000_000n });
    expect(await lines(r.entryId)).toEqual([["1219", 2_000_000n, 0n], ["1140", 11_000_000n, 0n], ["1210", 0n, 12_000_000n], ["7300", 0n, 1_000_000n]]);
    const entry = await db.journalEntry.findUniqueOrThrow({ where: { id: r.entryId } });
    expect(entry).toMatchObject({ kind: "ADJUSTMENT", memo: "Pelepasan aset: Mesin jahit (laba Rp 1.000.000)" });
    expect((await db.adjustmentSchedule.findUniqueOrThrow({ where: { id: a.scheduleId! } })).stoppedAt?.toISOString().slice(0, 10)).toBe("2026-10-20");
    // October: listed with its year's depreciation, derecognised; the GL agrees (1210 and 1219 back to zero).
    const [row] = await assetRegister(db, g.client.id, 2026, 10);
    expect(row).toMatchObject({ cost: 0n, accumulated: 0n, bookYtd: 2_000_000n });
    expect((await registerVsLedger(db, g.client.id, 2026, 10))[0].equal).toBe(true);
    expect(await assetRegister(db, g.client.id, 2027, 1)).toEqual([]);
    await expect(disposeAsset(db, { clientId: g.client.id, assetId: a.id, date: "2026-10-21", proceeds: "0", proceedsCode: "1140" })).rejects.toThrow(/sudah dilepas/);
  });

  it("writes off with no proceeds at a loss, and creates 7300 on a client that doesn't have it", async () => {
    const g = await makeGroup();
    await db.account.deleteMany({ where: { clientId: g.client.id, code: "7300" } });
    const a = await machine(g);
    await post(g, a.scheduleId!, 1);
    const r = await disposeAsset(db, { clientId: g.client.id, assetId: a.id, date: "2026-09-30", proceeds: "0", proceedsCode: "1140" });
    expect(await lines(r.entryId)).toEqual([["1219", 1_000_000n, 0n], ["1210", 0n, 12_000_000n], ["7300", 11_000_000n, 0n]]);
    expect(await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code: "7300" } })).toMatchObject({ name: "Laba/Rugi Pelepasan Aset Tetap", type: "BEBAN", fsLine: "BEBAN_LAIN" });
  });

  it("asks for the account when 7300 means something else to the client", async () => {
    const g = await makeGroup();
    await db.account.updateMany({ where: { clientId: g.client.id, code: "7300" }, data: { name: "Beban Donasi" } });
    const a = await machine(g);
    await post(g, a.scheduleId!, 1);
    await expect(disposeAsset(db, { clientId: g.client.id, assetId: a.id, date: "2026-09-30", proceeds: "0", proceedsCode: "1140" })).rejects.toThrow(/7300 dipakai untuk "Beban Donasi"/);
    const r = await disposeAsset(db, { clientId: g.client.id, assetId: a.id, date: "2026-09-30", proceeds: "0", proceedsCode: "1140", gainLossCode: "6190" });
    expect((await lines(r.entryId)).at(-1)).toEqual(["6190", 11_000_000n, 0n]);
  });

  it("sells land at book value without depreciation lines, and never into a bank account", async () => {
    const g = await makeGroup();
    const land = await createAsset(db, { clientId: g.client.id, entityId: g.pt.entity.id, name: "Tanah", taxGroup: "TANAH", fiscalMethod: "GARIS_LURUS", acquiredOn: "2026-01-05", cost: "500000000", assetAccountCode: "1210" });
    await expect(disposeAsset(db, { clientId: g.client.id, assetId: land.id, date: "2026-09-01", proceeds: "500000000", proceedsCode: "1101" })).rejects.toThrow(/bukan akun bank/);
    const r = await disposeAsset(db, { clientId: g.client.id, assetId: land.id, date: "2026-09-01", proceeds: "500000000", proceedsCode: "1140" });
    expect(await lines(r.entryId)).toEqual([["1140", 500_000_000n, 0n], ["1210", 0n, 500_000_000n]]);
    expect(r.result).toBe(0n);
  });

  it("refuses a locked month", async () => {
    const g = await makeGroup();
    const a = await machine(g);
    await post(g, a.scheduleId!, 1);
    await db.period.upsert({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month: 9 } }, update: { status: "LOCKED" }, create: { firmId: g.firm.id, clientId: g.client.id, year: 2026, month: 9, status: "LOCKED" } });
    await expect(disposeAsset(db, { clientId: g.client.id, assetId: a.id, date: "2026-09-15", proceeds: "0", proceedsCode: "1140" })).rejects.toThrow(/dikunci|ditutup/i);
    expect((await db.fixedAsset.findUniqueOrThrow({ where: { id: a.id } })).disposalEntryId).toBeNull();
  });
});
