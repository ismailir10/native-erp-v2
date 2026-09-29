import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { importStatement } from "@/lib/import/pipeline";
import { createInvoice } from "@/lib/receivables/invoices";
import { settleWithReclass } from "@/lib/receivables/settle";
import { ckpn, postCkpn, saveCkpnSetting, type CkpnSettingInput } from "@/lib/receivables/ckpn";
import { runControls } from "@/lib/controls";
import { taxPack } from "@/lib/tax/pack";

type G = Awaited<ReturnType<typeof makeGroup>>;

/** PT Uji's BCA Giro (invented): a partial receipt in June, a full one in July. */
const CSV = ["Tanggal;Keterangan;Debet;Kredit;Saldo", "10/06/2026;TRSF CR PT MITRA UNGGAS INV-1;0;6000000;106000000", "15/07/2026;TRSF CR TOKO JAYA INV-2;0;20000000;126000000", ""].join("\n");

/**
 * Month-ends May–Aug 2026: INV-1 (due 20 May, 10 jt, 6 jt paid in June) ages to > 90 hari with 4 jt open; INV-2 (due 30 Jun, 20 jt)
 * is paid in July; INV-3 (due 31 Jul, 8 jt) stays open; INV-4 (due 9 Sep, 5 jt) is current at August's end.
 */
async function books(g: G) {
  await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca.csv", data: Buffer.from(CSV), provider: null });
  const sale = (number: string, contactName: string, issueDate: string, dueDate: string, dpp: string) =>
    createInvoice(db, { clientId: g.client.id, entityId: g.pt.entity.id, direction: "SALES", contactName, number, issueDate, dueDate, dpp, counterCode: "4100" });
  const a = await sale("INV-1", "PT Mitra Unggas", "2026-05-05", "2026-05-20", "10000000");
  const b = await sale("INV-2", "Toko Jaya", "2026-06-01", "2026-06-30", "20000000");
  await sale("INV-3", "Toko Jaya", "2026-07-01", "2026-07-31", "8000000");
  await sale("INV-4", "PT Mitra Unggas", "2026-08-10", "2026-09-09", "5000000");
  const tx = (text: string) => db.bankTransaction.findFirstOrThrow({ where: { description: { contains: text } } });
  await settleWithReclass(db, { clientId: g.client.id, invoiceId: a.id, bankTransactionId: (await tx("MITRA")).id });
  await settleWithReclass(db, { clientId: g.client.id, invoiceId: b.id, bankTransactionId: (await tx("TOKO JAYA")).id });
}
const setting = (g: G, over: Partial<CkpnSettingInput> = {}) =>
  saveCkpnSetting(db, { clientId: g.client.id, entityId: g.pt.entity.id, method: "ROLL_RATE", historyMonths: 3, forward: "100", lastBucket: "100", manual: ["0", "0", "0", "0"], ...over });
const lines = async (entryId: string) => (await db.journalLine.findMany({ where: { entryId }, include: { account: true }, orderBy: { id: "asc" } })).map((l) => [l.account.code, l.debit, l.credit]);

describe("CKPN piutang (PSAK 109)", () => {
  beforeEach(resetDb);

  it("builds the matrix from month-end aging, posts the allowance, then a release", async () => {
    const g = await makeGroup();
    await books(g);
    const at = () => ckpn(db, g.client.id, g.pt.entity.id, 2026, 8);
    await expect(postCkpn(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month: 8 })).rejects.toThrow(/Simpan pengaturan CKPN/);
    await setting(g);
    const c = await at();
    expect(c.snapshots.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31"]);
    expect(c.rows.map((r) => [r.bucket, r.open, r.roll, r.rate, r.amount])).toEqual([
      ["CURRENT", 5_000_000n, 500_000n, 200_000n, 1_000_000n], // Jun→Jul INV-2 0 %, Jul→Aug INV-3 100 %
      ["D1_30", 0n, 400_000n, 400_000n, 0n], // May→Jun INV-1: 4 of 10 jt still open
      ["D31_60", 8_000_000n, 1_000_000n, 1_000_000n, 8_000_000n],
      ["D61_90", 0n, 1_000_000n, 1_000_000n, 0n],
      ["OVER_90", 4_000_000n, null, 1_000_000n, 4_000_000n],
    ]);
    expect([c.total, c.balance, c.difference, c.blocker]).toEqual([13_000_000n, 0n, 13_000_000n, null]);

    const control = async (month: number) => (await runControls(db, g.client.id, 2026, month)).find((x) => x.key === `ckpn:${g.pt.entity.id}`);
    expect(await control(8)).toMatchObject({ status: "REVIEW", detail: expect.stringMatching(/tambah Rp\s?13\.000\.000/) });

    const up = await postCkpn(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month: 8 });
    expect(up).toMatchObject({ kind: "ADJUSTMENT", memo: "CKPN piutang usaha per 31 Agu 2026 (PSAK 109): penambahan cadangan" });
    expect(await lines(up.id)).toEqual([["6185", 13_000_000n, 0n], ["1135", 0n, 13_000_000n]]);
    expect((await at()).difference).toBe(0n);
    expect(await control(8)).toMatchObject({ status: "PASS" });
    await expect(postCkpn(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month: 8 })).rejects.toThrow(/Tidak ada selisih/);
    // An earlier month can't be booked under a later allowance.
    await expect(postCkpn(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month: 7 })).rejects.toThrow(/sudah dijurnal per 31 Agu 2026/);

    // Manual rates: 1 % / 5 % / 50 % / 75 % / 100 % → 50 000 + 4 jt + 4 jt; the allowance is released by 4 950 000.
    await setting(g, { method: "MANUAL", manual: ["1", "5", "50", "75"] });
    const m = await at();
    expect([m.total, m.difference, m.snapshots]).toEqual([8_050_000n, -4_950_000n, []]);
    const down = await postCkpn(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month: 8 });
    expect(down.memo).toMatch(/pemulihan cadangan/);
    expect(await lines(down.id)).toEqual([["1135", 4_950_000n, 0n], ["6185", 0n, 4_950_000n]]);

    // The allowance is a deductible temporary difference: DTA 22 % of 8 050 000.
    const pack = await taxPack(db, g.client.id, g.pt.entity.id, 2026, 8);
    expect(pack!.deferred).toEqual({ assets: 0n, allowance: 8_050_000n, temporaryDifference: 8_050_000n, amount: 1_771_000n });
    expect(pack!.suggestions.find((s) => s.code === "6185")).toMatchObject({ category: "PROVISION", amount: 8_050_000n });
  });

  it("forward-looking factor, missing history and validation", async () => {
    const g = await makeGroup();
    await books(g);
    await setting(g, { forward: "110" });
    expect((await ckpn(db, g.client.id, g.pt.entity.id, 2026, 8)).total).toBe(14_300_000n);
    // Two months of history (Jun–Aug) never saw 1–30 hari roll, so current (open 5 jt) has no loss rate.
    await setting(g, { historyMonths: 2 });
    const short = await ckpn(db, g.client.id, g.pt.entity.id, 2026, 8);
    expect([short.snapshots.length, short.rows[1].roll, short.rows[0].rate, short.total]).toEqual([3, null, null, null]);
    expect(short.blocker).toMatch(/riwayat roll rate untuk belum jatuh tempo/);
    // May: the first month with invoices → fewer than two month-ends.
    const may = await ckpn(db, g.client.id, g.pt.entity.id, 2026, 5);
    expect(may.blocker).toMatch(/minimal dua akhir bulan/);
    await expect(postCkpn(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month: 5 })).rejects.toThrow(/minimal dua akhir bulan/);
    await expect(setting(g, { forward: "301" })).rejects.toThrow(/forward-looking/);
    await expect(setting(g, { method: "MANUAL", manual: ["1", "abc", "0", "0"] })).rejects.toThrow(/1–30 hari/);
    await expect(setting(g, { historyMonths: 1 })).rejects.toThrow(/2–36/);
    // A client that uses 1135 for something else is refused by name.
    await setting(g);
    await db.account.update({ where: { clientId_code: { clientId: g.client.id, code: "1135" } }, data: { fsLine: "PIUTANG_LAIN" } });
    await expect(postCkpn(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month: 8 })).rejects.toThrow(/Akun 1135 dipakai/);
  });
});
