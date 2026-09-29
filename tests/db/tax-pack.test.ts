import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { importStatement } from "@/lib/import/pipeline";
import { createAsset } from "@/lib/assets/register";
import { postInstallment } from "@/lib/adjust/schedules";
import { taxPack } from "@/lib/tax/pack";
import { dateOnly } from "@/lib/format";

type G = Awaited<ReturnType<typeof makeGroup>>;
const acc = async (g: G, code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
const journal = async (g: G, date: Date, dr: string, cr: string, amount: bigint, memo = "uji") =>
  db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date, kind: "ADJUSTMENT", memo, lines: [{ accountId: await acc(g, dr), debit: amount }, { accountId: await acc(g, cr), credit: amount }] }));

/** PT Uji, Jan–Sep 2026 (invented): revenue 1 M, interest 10 jt, salaries 400 jt, a donation 5 jt, PPh 25 paid 30 jt from the bank. */
async function year(g: G) {
  await db.account.create({ data: { firmId: g.firm.id, clientId: g.client.id, code: "6195", name: "Beban Sumbangan", type: "BEBAN", normalBalance: "DEBIT", fsLine: "BEBAN_UMUM_ADM" } });
  await journal(g, dateOnly(2026, 3, 31), "1130", "4100", 1_000_000_000n, "Penjualan");
  await journal(g, dateOnly(2026, 3, 31), "1110", "4900", 10_000_000n, "Bunga");
  await journal(g, dateOnly(2026, 4, 30), "6100", "1110", 400_000_000n, "Gaji");
  await journal(g, dateOnly(2026, 5, 31), "6195", "1110", 5_000_000n, "Sumbangan");
  const csv = ["Tanggal;Keterangan;Debet;Kredit;Saldo", "15/06/2026;SETORAN PPH 25 MASA MEI;30000000;0;970000000", ""].join("\n");
  await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca.csv", data: Buffer.from(csv), provider: null });
}
const lines = (p: { code: string; amount: bigint }[]) => p.map((l) => [l.code, l.amount]);

describe("tax pack", () => {
  beforeEach(resetDb);

  it("goes from commercial profit through corrections, 31E and credits to PPh 29 and the current-tax journal", async () => {
    const g = await makeGroup();
    await year(g);
    const pph25 = await db.bankTransaction.findFirstOrThrow({ where: { description: { contains: "PPH 25" } } });
    expect(pph25).toMatchObject({ accountCode: "1180", taxTag: "PPH_25", status: "POSTED" }); // the fixed firm rule
    const ty = await db.taxYear.create({ data: { firmId: g.firm.id, clientId: g.client.id, entityId: g.pt.entity.id, year: 2026 } });
    await db.taxCredit.create({ data: { firmId: g.firm.id, taxYearId: ty.id, type: "PPH_23", reference: "BP-0001", date: dateOnly(2026, 7, 10), amount: 2_000_000n, accountId: await acc(g, "1180") } });

    const p = (await taxPack(db, g.client.id, g.pt.entity.id, 2026, 9))!;
    expect(p).toMatchObject({ applicable: true, regime: "NORMAL", profitBeforeTax: 605_000_000n, turnover: 1_000_000_000n, positive: 0n, negative: 10_000_000n, fiscalProfit: 595_000_000n });
    expect(p.corrections.map((c) => [c.key, c.direction, c.kind, c.amount])).toEqual([["auto:final:4900", "NEGATIVE", "PERMANENT", 10_000_000n]]);
    expect(p.suggestions).toMatchObject([{ key: "nd:6195", code: "6195", name: "Beban Sumbangan", amount: 5_000_000n, category: "DONATION", percent: 100, corrected: 5_000_000n }]);
    // Turnover ≤ 4,8 M: all PKP at 11 %.
    expect(p.tax).toMatchObject({ pkp: 595_000_000n, facilityPkp: 595_000_000n, due: 65_450_000n });
    expect(p.credits.map((c) => [c.type, c.amount, c.accountCode])).toEqual([["PPH_25", 30_000_000n, "1180"], ["PPH_23", 2_000_000n, "1180"]]);
    expect(p.settlement).toEqual({ credits: 32_000_000n, balance: 33_450_000n, nextInstalment: 5_287_500n });
    expect(lines(p.proposals.CURRENT)).toEqual([["1180", -32_000_000n], ["2146", -33_450_000n], ["8100", 65_450_000n]]);
    expect(p.deferred).toBeNull();
  });

  it("takes a PPh 25 already expensed on 8100 off the expense instead of a prepaid account", async () => {
    const g = await makeGroup();
    await db.rule.create({ data: { firmId: g.firm.id, clientId: g.client.id, pattern: "PPH 25", direction: "OUT", accountCode: "8100", taxTag: "PPH_25", priority: 1, source: "USER" } });
    await year(g);
    const p = (await taxPack(db, g.client.id, g.pt.entity.id, 2026, 9))!;
    expect(p.credits.map((c) => [c.amount, c.accountCode])).toEqual([[30_000_000n, "8100"]]);
    // Due 65,45 jt − 30 jt already on 8100; PPh 29 = 35,45 jt.
    expect(lines(p.proposals.CURRENT)).toEqual([["2146", -35_450_000n], ["8100", 35_450_000n]]);
  });

  it("computes the final 0,5 % regime without corrections, credits or a journal", async () => {
    const g = await makeGroup();
    await year(g);
    await db.taxYear.create({ data: { firmId: g.firm.id, clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, regime: "FINAL_UMKM" } });
    const p = (await taxPack(db, g.client.id, g.pt.entity.id, 2026, 9))!;
    expect(p).toMatchObject({ regime: "FINAL_UMKM", positive: 0n, negative: 0n, settlement: null, proposals: { CURRENT: [], DEFERRED: [] } });
    expect(p.tax.due).toBe(5_000_000n);
  });

  it("corrects depreciation from the asset register and proposes deferred tax on the temporary difference", async () => {
    const g = await makeGroup();
    const buy = await journal(g, dateOnly(2026, 8, 10), "1210", "2110", 48_000_000n, "Laptop");
    const a = await createAsset(db, { clientId: g.client.id, entityId: g.pt.entity.id, name: "Laptop", taxGroup: "KELOMPOK_1", fiscalMethod: "GARIS_LURUS", acquiredOn: "2026-08-10", cost: "48000000", assetAccountCode: "1210", sourceEntryId: buy.id });
    await postInstallment(db, { clientId: g.client.id, scheduleId: a.scheduleId!, k: 1 });
    const p = (await taxPack(db, g.client.id, g.pt.entity.id, 2026, 9))!;
    // Book: September only (1 jt); fiscal: August and September (2 jt) → −1 jt, a timing difference.
    expect(p.corrections.map((c) => [c.key, c.direction, c.kind, c.amount])).toEqual([["auto:depreciation", "NEGATIVE", "TEMPORARY", 1_000_000n]]);
    // Fiscal value 46 jt < book value 47 jt: a deferred tax liability of 22 % × 1 jt.
    expect(p.deferred).toEqual({ temporaryDifference: -1_000_000n, amount: -220_000n });
    expect(lines(p.proposals.DEFERRED)).toEqual([["2320", -220_000n], ["8110", 220_000n]]);
  });

  it("doesn't apply to an individual", async () => {
    const g = await makeGroup();
    const p = (await taxPack(db, g.client.id, g.owner.entity.id, 2026, 9))!;
    expect(p.applicable).toBe(false);
    expect(p.proposals.CURRENT).toEqual([]);
  });
});
