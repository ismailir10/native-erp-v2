import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { upsertRate } from "@/lib/fx/rates";
import { balanceSheet, combinedWorksheet, incomeStatement, trialBalance } from "@/lib/reports/ledger";
import { FxMissingError } from "@/lib/reports/fx";
import { dateOnly } from "@/lib/format";

/**
 * Hand-computed example (rule 11). PT (IDR): Kas 1.000.000 / Modal. HoldCo (SGD): Kas S$500 / Modal on 15 Jan 2025,
 * then expense S$12 on 30 Jun. Rates SGD→IDR: historical (Jan) 12.000, closing (Jun) 12.500, average 2025 12.200.
 * HoldCo in IDR: Kas 488 × 12.500 = 6.100.000; Modal −500 × 12.000 = −6.000.000; Beban 12 × 12.200 = 146.400;
 * Σ = 246.400 → 3900 Selisih penjabaran −246.400 (credit).
 */
async function setup(withAverage = true) {
  const g = await makeGroup();
  const hc = g.owner.entity; // reuse the second entity as the SGD HoldCo
  await db.entity.update({ where: { id: hc.id }, data: { functionalCurrency: "SGD", shortName: "HoldCo" } });
  const acc = async (code: string) => (await db.account.findUniqueOrThrow({ where: { clientId_code: { clientId: g.client.id, code } } })).id;
  const [kas, bank, modal, beban] = [await acc("1110"), await acc("1120"), await acc("3100"), await acc("6170")];
  await db.$transaction(async (tx) => {
    await postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2025, 1, 15), kind: "ADJUSTMENT", memo: "modal", lines: [{ accountId: kas, debit: 1_000_000n }, { accountId: modal, credit: 1_000_000n }] });
    await postJournal(tx, { entityId: hc.id, date: dateOnly(2025, 1, 15), kind: "ADJUSTMENT", memo: "modal", lines: [{ accountId: bank, debit: 50_000n }, { accountId: modal, credit: 50_000n }] });
    await postJournal(tx, { entityId: hc.id, date: dateOnly(2025, 6, 30), kind: "ADJUSTMENT", memo: "beban", lines: [{ accountId: beban, debit: 1_200n }, { accountId: bank, credit: 1_200n }] });
  });
  await upsertRate(db, g.firm.id, { currency: "SGD", quote: "IDR", date: dateOnly(2025, 1, 31), kind: "SPOT", rate: "12000" });
  await upsertRate(db, g.firm.id, { currency: "SGD", quote: "IDR", date: dateOnly(2025, 6, 30), kind: "SPOT", rate: "12500" });
  if (withAverage) await upsertRate(db, g.firm.id, { currency: "SGD", quote: "IDR", date: dateOnly(2025, 12, 31), kind: "AVERAGE", rate: "12200" });
  return { g, hc, all: { clientId: g.client.id, entityIds: [g.pt.entity.id, hc.id] } };
}

describe("translation of a non-IDR entity into the combined view", () => {
  beforeEach(resetDb);
  const asOf = dateOnly(2025, 6, 30);

  it("single-entity reports stay in the functional currency", async () => {
    const { g, hc } = await setup();
    const tb = await trialBalance(db, { clientId: g.client.id, entityIds: [hc.id] }, asOf);
    expect(Object.fromEntries(tb.filter((r) => r.net).map((r) => [r.account.code, r.net]))).toEqual({ "1120": 48_800n, "3100": -50_000n, "6170": 1_200n });
  });

  it("combined TB is in IDR with the residue on 3900 and still balances", async () => {
    const { all } = await setup();
    const tb = await trialBalance(db, all, asOf);
    expect(Object.fromEntries(tb.filter((r) => r.net).map((r) => [r.account.code, r.net]))).toEqual({
      "1110": 1_000_000n,
      "1120": 6_100_000n,
      "3100": -7_000_000n,
      "3900": -246_400n,
      "6170": 146_400n,
    });
    expect(tb.reduce((s, r) => s + r.net, 0n)).toBe(0n);
  });

  it("combined Neraca balances and shows the translation line; Laba Rugi uses the average rate", async () => {
    const { all } = await setup();
    const bs = await balanceSheet(db, all, asOf);
    expect(bs.totals).toMatchObject({ assets: 7_100_000n, difference: 0n });
    expect(bs.equity.find((i) => i.fsLine === "SELISIH_PENJABARAN")?.amount).toBe(246_400n);
    const is = await incomeStatement(db, all, dateOnly(2025, 1, 1), asOf);
    expect(is.totals.netProfit).toBe(-146_400n);
  });

  it("the worksheet shows every column in IDR and sums to zero", async () => {
    const { g } = await setup();
    const ws = await combinedWorksheet(db, g.client.id, asOf);
    expect(ws.translated).toBe(true);
    expect(ws.rows.reduce((s, r) => s + r.combined, 0n)).toBe(0n);
    expect(ws.rows.find((r) => r.code === "3900")?.values).toEqual([0n, -246_400n]);
  });

  it("a missing rate throws instead of guessing", async () => {
    const { all } = await setup(false);
    await expect(trialBalance(db, all, asOf)).rejects.toThrow(FxMissingError);
    await expect(trialBalance(db, all, asOf)).rejects.toThrow(/HoldCo — kurs rata-rata SGD→IDR 2025/);
    await expect(trialBalance(db, all, dateOnly(2025, 7, 31))).rejects.toThrow(/kurs penutup SGD→IDR bulan Jul 2025/);
  });

  it("a year without income or expense doesn't need that year's average (HoldCo opening Neraca only)", async () => {
    const { all } = await setup(false);
    const jan = dateOnly(2025, 1, 31);
    // As of January the HoldCo has only its capital entry: closing + historical are enough.
    const tb = await trialBalance(db, all, jan);
    expect(tb.reduce((s, r) => s + r.net, 0n)).toBe(0n);
    expect((await incomeStatement(db, all, dateOnly(2025, 1, 1), jan)).totals.netProfit).toBe(0n);
    // June has the S$12 expense: the average is required again.
    await expect(trialBalance(db, all, asOf)).rejects.toThrow(/kurs rata-rata SGD→IDR 2025/);
  });
});
