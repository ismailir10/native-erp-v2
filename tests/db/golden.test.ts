import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { db, resetDb } from "../helpers";
import { GOLDEN_END, goldenKey, goldenScenario, seedGolden } from "@/lib/demo/golden";
import { balanceSheet, incomeStatement, trialBalance, type Scope } from "@/lib/reports/ledger";
import { cashFlow } from "@/lib/reports/statements";
import { importStatement } from "@/lib/import/pipeline";
import { reviewTransaction } from "@/lib/review";
import { dateOnly } from "@/lib/format";

/**
 * Golden test (use-case feedback UC-K1 / UC-K5): the Belifi-pattern group through the real pipeline must give the committed key
 * numbers to the rupiah, and the independent calculator must give them too — two layers that can't be wrong the same way.
 */
const KEY_FILE = path.join(__dirname, "../golden/belifi-pattern.json");
const committed = (() => {
  const { _about, ...rest } = JSON.parse(readFileSync(KEY_FILE, "utf8")) as Record<string, string>;
  void _about;
  return rest;
})();

async function appKey(clientId: string, ptId: string, ownerId: string) {
  const one = async (entityIds: string[]) => {
    const scope: Scope = { clientId, entityIds };
    const [bs, is, tb] = await Promise.all([balanceSheet(db, scope, GOLDEN_END), incomeStatement(db, scope, dateOnly(2026, 1, 1), GOLDEN_END), trialBalance(db, scope, GOLDEN_END)]);
    const net = (code: string) => tb.find((r) => r.account.code === code)?.net ?? 0n;
    return { bs, is, net };
  };
  const [pt, owner, group] = await Promise.all([one([ptId]), one([ownerId]), one([ptId, ownerId])]);
  const s = (v: bigint) => v.toString();
  return {
    "pt.totalAssets": s(pt.bs.totals.assets),
    "pt.totalLiabilities": s(pt.bs.totals.liabilities),
    "pt.totalEquity": s(pt.bs.totals.equity),
    "pt.revenue": s(pt.is.totals.revenue),
    "pt.netProfit": s(pt.is.totals.netProfit),
    "pt.cash.bca": s(pt.net("1101")),
    "pt.cash.mandiri": s(pt.net("1102")),
    "pt.cash.petty": s(pt.net("1110")),
    "pt.1199": s(pt.net("1199")),
    "pt.1190": s(pt.net("1190")),
    "pt.retainedOpening": s(-pt.net("3200")),
    "owner.totalAssets": s(owner.bs.totals.assets),
    "owner.totalLiabilities": s(owner.bs.totals.liabilities),
    "owner.totalEquity": s(owner.bs.totals.equity),
    "owner.netProfit": s(owner.is.totals.netProfit),
    "owner.cash.bca": s(owner.net("1103")),
    "owner.prive": s(owner.net("3300")),
    "owner.1190": s(owner.net("1190")),
    "group.totalAssets": s(group.bs.totals.assets),
    "group.netProfit": s(group.is.totals.netProfit),
  };
}

describe("golden dataset (Belifi pattern)", () => {
  const sc = goldenScenario();
  let ids: { clientId: string; ptId: string; ownerId: string };
  let imported: Awaited<ReturnType<typeof seedGolden>>["imported"];

  beforeAll(async () => {
    await resetDb();
    const g = await seedGolden(db, sc);
    ids = { clientId: g.client.id, ptId: g.entities[0].entity.id, ownerId: g.entities[1].entity.id };
    imported = g.imported;
  }, 180_000);

  it("is big enough to mean something: ≥ 250 lines over three months and three accounts, 20 key numbers", () => {
    expect(sc.lines.length).toBeGreaterThanOrEqual(250);
    expect(new Set(sc.lines.map((l) => l.bankKey)).size).toBe(3);
    expect(Object.keys(committed)).toHaveLength(20);
  });

  it("the independent calculator gives the committed key", () => {
    expect(goldenKey(sc)).toEqual(committed);
  });

  it("the app gives the committed key to the rupiah (TB, Laba Rugi, Neraca, combined)", async () => {
    expect(await appKey(ids.clientId, ids.ptId, ids.ownerId)).toEqual(committed);
  });

  it("the cash flow ends at the Neraca's cash, per entity", async () => {
    const pt = await cashFlow(db, { clientId: ids.clientId, entityIds: [ids.ptId] }, GOLDEN_END);
    expect(pt.closingCash).toBe(BigInt(committed["pt.cash.bca"]) + BigInt(committed["pt.cash.mandiri"]) + BigInt(committed["pt.cash.petty"]));
    const owner = await cashFlow(db, { clientId: ids.clientId, entityIds: [ids.ownerId] }, GOLDEN_END);
    expect(owner.closingCash).toBe(BigInt(committed["owner.cash.bca"]));
  });

  it("importing every file again adds nothing and changes no number (deterministic)", async () => {
    const before = await db.bankTransaction.count();
    for (const f of imported) await importStatement(db, { ...f, provider: null });
    expect(await db.bankTransaction.count()).toBe(before);
    expect(await appKey(ids.clientId, ids.ptId, ids.ownerId)).toEqual(committed);
  });

  it("a reclassification moves TB, Laba Rugi and Neraca by exactly its amount, recorded as RECLASS; moving it back restores the key", async () => {
    const t = await db.bankTransaction.findFirstOrThrow({ where: { entityId: ids.ptId, description: "META PLATFORMS IRELAND ADS", date: { gte: dateOnly(2026, 6, 1) } } });
    const amount = -t.amount;
    await reviewTransaction(db, { bankTxId: t.id, accountCode: "1160", taxTag: null, learn: false });
    const moved = await appKey(ids.clientId, ids.ptId, ids.ownerId);
    expect(BigInt(moved["pt.netProfit"]) - BigInt(committed["pt.netProfit"])).toBe(amount);
    expect(BigInt(moved["pt.totalAssets"]) - BigInt(committed["pt.totalAssets"])).toBe(amount);
    expect(BigInt(moved["pt.totalEquity"]) - BigInt(committed["pt.totalEquity"])).toBe(amount);
    expect(BigInt(moved["group.netProfit"]) - BigInt(committed["group.netProfit"])).toBe(amount);
    const reclass = await db.journalEntry.findFirst({ where: { bankTransactionId: t.id, kind: "RECLASS" }, include: { lines: { include: { account: true } } } });
    expect(reclass?.lines.map((l) => [l.account.code, l.debit, l.credit]).sort()).toEqual([["1160", amount, 0n], ["6150", 0n, amount]]);

    await reviewTransaction(db, { bankTxId: t.id, accountCode: "6150", taxTag: null, learn: false });
    expect(await appKey(ids.clientId, ids.ptId, ids.ownerId)).toEqual(committed);
  });
});
