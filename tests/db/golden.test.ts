import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { db, resetDb } from "../helpers";
import { randomUUID } from "node:crypto";
import { GOLDEN_END, GOLDEN_PETTY_CASH, goldenKey, goldenScenario, reviewWithTruth, seedGolden } from "@/lib/demo/golden";
import { removeStatementImport } from "@/lib/imports/remove";
import { runControls } from "@/lib/controls";
import { reportStatus } from "@/lib/reports/status";
import { resolveOpeningFinding } from "@/lib/findings";
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

describe("golden dataset with the old Neraca's petty cash left out (UC-B4)", () => {
  const sc = goldenScenario();

  it("opens T-001 for exactly the missing Rp 60 jt, fails the close, and reaches the key once the decision moves it to Kas Kecil", async () => {
    await resetDb();
    const g = await seedGolden(db, sc, { omitPettyCash: true });
    const ids = { clientId: g.client.id, ptId: g.entities[0].entity.id, ownerId: g.entities[1].entity.id };
    const [finding] = await db.finding.findMany({ where: { clientId: ids.clientId } });
    expect(finding).toMatchObject({ number: 1, status: "OPEN", amount: GOLDEN_PETTY_CASH, entityId: ids.ptId });

    // The difference is visible, not in Saldo Laba: 3290 holds it and the close refuses.
    const before = await appKey(ids.clientId, ids.ptId, ids.ownerId);
    expect(before["pt.retainedOpening"]).toBe(committed["pt.retainedOpening"]);
    expect(BigInt(before["pt.totalAssets"])).toBe(BigInt(committed["pt.totalAssets"]) - GOLDEN_PETTY_CASH);
    const controls = await runControls(db, ids.clientId, 2026, 4);
    expect(controls.find((c) => c.key === `opening-diff:${ids.ptId}`)).toMatchObject({ status: "FAIL", detail: expect.stringContaining("temuan T-001") });
    expect((await reportStatus(db, ids.clientId, [ids.ptId], 2026, 6)).reasons[0]).toMatchObject({ kind: "findings", items: [{ labels: ["T-001"], amount: GOLDEN_PETTY_CASH }] });

    await resolveOpeningFinding(db, { clientId: ids.clientId, findingId: finding.id, accountCode: "1110", decision: "Kas kecil di brankas kantor, dikonfirmasi pemilik" });
    expect(await appKey(ids.clientId, ids.ptId, ids.ownerId)).toEqual(committed);
    expect((await runControls(db, ids.clientId, 2026, 4)).find((c) => c.key.startsWith("opening-diff:"))).toBeUndefined();
    expect((await reportStatus(db, ids.clientId, [ids.ptId], 2026, 6)).reasons.find((r) => r.kind === "findings")).toBeUndefined();
  }, 180_000);
});

describe("golden dataset: removing a statement and importing it again (UC-K4)", () => {
  const sc = goldenScenario();

  it("removing June's PT BCA statement gives exactly the key without that file; importing it again gives the key", async () => {
    await resetDb();
    const g = await seedGolden(db, sc);
    const ids = { clientId: g.client.id, ptId: g.entities[0].entity.id, ownerId: g.entities[1].entity.id };
    const admin = await db.firmMember.create({ data: { firmId: g.firm.id, userId: randomUUID(), email: "admin-golden@example.test", name: "Admin", role: "ADMIN" } });
    const june = g.imported.find((f) => f.fileName.includes("2026-06") && f.bankAccountId === g.entities[0].banks[0].id)!;
    const imp = await db.statementImport.findFirstOrThrow({ where: { bankAccountId: june.bankAccountId, fileName: june.fileName } });

    await removeStatementImport(db, { clientId: ids.clientId, importId: imp.id, reason: "Uji: hapus lalu impor ulang", actor: { id: admin.id, role: "ADMIN" } });
    // The key of the same group without that file, from the generator alone: the June BCA lines simply never happened.
    const without = { ...sc, lines: sc.lines.filter((l) => !(l.bankKey === "pt-bca" && l.date.getUTCMonth() + 1 === 6)) };
    expect(await appKey(ids.clientId, ids.ptId, ids.ownerId)).toEqual(goldenKey(without));

    await importStatement(db, { ...june, provider: null });
    await reviewWithTruth(db, sc, ids.clientId);
    expect(await appKey(ids.clientId, ids.ptId, ids.ownerId)).toEqual(committed);
  }, 180_000);
});
