import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { importCensus, qxOf, saveBenefitSetting, uploadMortality } from "@/lib/benefits/census";
import { postBenefits, valuation } from "@/lib/benefits/valuation";
import { valueEmployee, type Assumptions } from "@/lib/benefits/puc";
import { postJournal } from "@/lib/ledger/post";
import { runControls } from "@/lib/controls";
import { taxPack } from "@/lib/tax/pack";
import { dateOnly } from "@/lib/format";
import { CENSUS_CSV, mortalityCsv } from "../benefits-fixture";

type G = Awaited<ReturnType<typeof makeGroup>>;
const lines = async (entryId: string) => (await db.journalLine.findMany({ where: { entryId }, include: { account: true }, orderBy: { id: "asc" } })).map((l) => [l.account.code, l.debit - l.credit]);
const gl = async (g: G, code: string) => {
  const a = await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } });
  const s = await db.journalLine.aggregate({ where: { accountId: a.id }, _sum: { debit: true, credit: true } });
  return (s._sum.debit ?? 0n) - (s._sum.credit ?? 0n);
};

async function setup(g: G) {
  const table = await uploadMortality(db, { firmId: g.firm.id, name: "Tabel uji", fileName: "t.csv", data: mortalityCsv() });
  await importCensus(db, { clientId: g.client.id, entityId: g.pt.entity.id, fileName: "s.csv", data: Buffer.from(CENSUS_CSV) });
  await saveBenefitSetting(db, { clientId: g.client.id, entityId: g.pt.entity.id, mortalityTableId: table.id, discount: "7", salary: "5", retirementAge: 56, disability: "10", resign: "5", resignFlatUntil: 30, resignZeroAge: 55 });
  const a: Assumptions = { discount: 0.07, salary: 0.05, retirementAge: 56, disability: 0.1, resign: 0.05, resignFlatUntil: 30, resignZeroAge: 55, qx: qxOf(table) };
  return a;
}

describe("PSAK 24 valuation and journal", () => {
  beforeEach(resetDb);

  it("first year: prior periods to Saldo Laba, the year's cost to 6105, the rest to OCI; then nothing left", async () => {
    const g = await makeGroup();
    const post = (year: number, month: number) => postBenefits(db, { clientId: g.client.id, entityId: g.pt.entity.id, year, month });
    const at = (year: number, month: number) => valuation(db, g.client.id, g.pt.entity.id, year, month);
    expect((await at(2026, 12)).blocker).toMatch(/Isi asumsi/);
    const a = await setup(g);

    const v = await at(2026, 12);
    // Rina left in June 2026: three employees now, four at the previous 31 December.
    expect(v.employees.map((e) => e.name)).toEqual(["Budi Santoso", "Sari Dewi", "Andi Wijaya"]);
    const direct = (await db.employee.findMany({ where: { leftOn: null } })).reduce((t, e) => t + valueEmployee(e, a, dateOnly(2026, 12, 31)).dbo, 0n);
    expect(v.dbo).toBe(direct);
    expect(v.dbo).toBeGreaterThan(0n);
    expect(v.sensitivity!.discountUp).toBeLessThan(v.dbo);
    expect(v.sensitivity!.salaryUp).toBeGreaterThan(v.dbo);
    expect(v.firstYear).toBe(true);
    expect(v.expenseTarget).toBe(v.opening.serviceCost + v.opening.interestCost);
    expect(v.lines).toEqual([
      { code: "6105", amount: v.expenseTarget },
      { code: "3200", amount: v.opening.dbo },
      { code: "3920", amount: v.dbo - v.expenseTarget - v.opening.dbo },
      { code: "2310", amount: -v.dbo },
    ]);
    const control = async () => (await runControls(db, g.client.id, 2026, 12)).find((c) => c.key === `eb:${g.pt.entity.id}`);
    expect(await control()).toMatchObject({ status: "REVIEW" });

    const entry = await post(2026, 12);
    expect(entry.memo).toMatch(/^Imbalan kerja PSAK 24 per 31 Des 2026: liabilitas Rp/);
    expect(await lines(entry.id)).toEqual(v.lines.map((l) => [l.code, l.amount]));
    expect(await gl(g, "2310")).toBe(-v.dbo);
    expect((await at(2026, 12)).lines).toEqual([]);
    expect(await control()).toMatchObject({ status: "PASS" });
    await expect(post(2026, 12)).rejects.toThrow(/Tidak ada selisih/);
    await expect(post(2026, 11)).rejects.toThrow(/sudah dijurnal per 31 Des 2026/);

    // Tax: 2310 is a deductible temporary difference; the remeasurement's share of the deferred tax goes to 3920, not 8110.
    const pack = (await taxPack(db, g.client.id, g.pt.entity.id, 2026, 12))!;
    const remeasurement = v.dbo - v.expenseTarget - v.opening.dbo;
    expect(pack.deferred).toMatchObject({ employeeBenefits: v.dbo, temporaryDifference: v.dbo, amount: (v.dbo * 22n) / 100n, oci: (remeasurement * 22n) / 100n });
    const proposal = new Map(pack.proposals.DEFERRED.map((l) => [l.code, l.amount]));
    expect(proposal.get("1270")).toBe((v.dbo * 22n) / 100n);
    expect(proposal.get("3920")).toBe(-(remeasurement * 22n) / 100n);
    expect(proposal.get("8110")).toBe(-(v.dbo * 22n) / 100n + (remeasurement * 22n) / 100n);
    expect(pack.suggestions.find((s) => s.code === "6105")).toMatchObject({ category: "EMPLOYEE_BENEFITS", amount: v.expenseTarget });
  });

  it("next year: no Saldo Laba, benefits paid respected, OCI balances the obligation", async () => {
    const g = await makeGroup();
    await setup(g);
    await postBenefits(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month: 12 });
    // A benefit paid in 2027 out of the bank, booked against the liability.
    const acc = async (code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
    await db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2027, 3, 15), kind: "ADJUSTMENT", memo: "Pembayaran imbalan", lines: [{ accountId: await acc("2310"), debit: 5_000_000n }, { accountId: await acc("1120"), credit: 5_000_000n }] }));
    const v = await valuation(db, g.client.id, g.pt.entity.id, 2027, 12);
    expect(v.firstYear).toBe(false);
    const booked = -(await gl(g, "2310"));
    expect(v.lines.find((l) => l.code === "3200")).toBeUndefined();
    const oci = v.lines.find((l) => l.code === "3920")?.amount ?? 0n;
    expect(v.lines.find((l) => l.code === "6105")?.amount).toBe(v.expenseTarget);
    expect(v.expenseTarget + oci).toBe(v.dbo - booked);
    await postBenefits(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2027, month: 12 });
    expect(await gl(g, "2310")).toBe(-v.dbo);
  });
});
