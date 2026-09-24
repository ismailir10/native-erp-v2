import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { upsertRate } from "@/lib/fx/rates";
import { postRevaluation, revaluationProposals, RevaluationError } from "@/lib/fx/revalue";
import { runControls } from "@/lib/controls";
import { trialBalance } from "@/lib/reports/ledger";
import { dateOnly } from "@/lib/format";

/** SGD HoldCo borrows USD 150,000 at 1.31 (S$196,500). Closing USD→SGD 31 Jan 2023 = 1.34 → S$201,000: +S$4,500 on the bank, −S$4,500 on the USD loan. */
async function setup() {
  const g = await makeGroup();
  const e = g.pt.entity;
  await db.entity.update({ where: { id: e.id }, data: { functionalCurrency: "SGD" } });
  const acc = async (code: string) => (await db.account.findUniqueOrThrow({ where: { clientId_code: { clientId: g.client.id, code } } })).id;
  const [bank, loan, fee] = [await acc("1120"), await acc("2300"), await acc("7100")];
  await db.$transaction(async (tx) => {
    await postJournal(tx, {
      entityId: e.id,
      date: dateOnly(2023, 1, 3),
      kind: "IMPORTED",
      memo: "USD loan",
      lines: [
        { accountId: bank, debit: 19_650_000n, fx: { currency: "USD", amount: 15_000_000n, rate: "1.31" } },
        { accountId: loan, credit: 19_650_000n, fx: { currency: "USD", amount: 15_000_000n, rate: "1.31" } },
      ],
    });
    // An expense in USD is not revalued (not monetary).
    await postJournal(tx, { entityId: e.id, date: dateOnly(2023, 1, 5), kind: "IMPORTED", memo: "fee", lines: [{ accountId: fee, debit: 131n, fx: { currency: "USD", amount: 100n, rate: "1.31" } }, { accountId: bank, credit: 131n, fx: { currency: "USD", amount: 100n, rate: "1.31" } }] });
  });
  return { g, e };
}

describe("FX revaluation (proposed, click to post)", () => {
  beforeEach(resetDb);

  it("asks for the closing rate first", async () => {
    const { g } = await setup();
    const [p] = await revaluationProposals(db, g.client.id, 2023, 1);
    expect(p.missingRates).toEqual(["kurs penutup USD→SGD bulan Januari 2023"]);
    const c = (await runControls(db, g.client.id, 2023, 1)).find((x) => x.key.startsWith("reval:"))!;
    expect(c.status).toBe("REVIEW");
    await expect(postRevaluation(db, g.client.id, g.pt.entity.id, 2023, 1)).rejects.toThrow(RevaluationError);
  });

  it("proposes the difference, posts it to 7200 on request, then nothing is left", async () => {
    const { g, e } = await setup();
    await upsertRate(db, g.firm.id, { currency: "USD", quote: "SGD", date: dateOnly(2023, 1, 31), kind: "SPOT", rate: "1.34" });
    const [p] = await revaluationProposals(db, g.client.id, 2023, 1);
    expect(p.lines.map((l) => [l.code, l.fxBalance, l.carried, l.target, l.diff])).toEqual([
      ["1120", 14_999_900n, 19_649_869n, 20_099_866n, 449_997n],
      ["2300", -15_000_000n, -19_650_000n, -20_100_000n, -450_000n],
    ]);
    expect(await db.journalEntry.count({ where: { kind: "ADJUSTMENT" } })).toBe(0); // proposal only
    await postRevaluation(db, g.client.id, e.id, 2023, 1);
    const tb = await trialBalance(db, { clientId: g.client.id, entityIds: [e.id] }, dateOnly(2023, 1, 31));
    expect(tb.find((r) => r.account.code === "7200")?.net).toBe(3n); // net loss S$0.03 (bank +4,499.97, loan −4,500)
    const [after] = await revaluationProposals(db, g.client.id, 2023, 1);
    expect(after.lines).toEqual([]);
    const c = (await runControls(db, g.client.id, 2023, 1)).find((x) => x.key.startsWith("reval:"))!;
    expect(c.status).toBe("PASS");
    const reval = await db.journalLine.findMany({ where: { entry: { kind: "ADJUSTMENT" }, currency: "USD" } });
    expect(reval.every((l) => l.fxAmount === 0n && l.fxRate === "1.34")).toBe(true);
  });

  it("postJournal refuses a revaluation line that changes the foreign balance", async () => {
    const { g, e } = await setup();
    const bank = (await db.account.findUniqueOrThrow({ where: { clientId_code: { clientId: g.client.id, code: "1120" } } })).id;
    const fx = (await db.account.findUniqueOrThrow({ where: { clientId_code: { clientId: g.client.id, code: "7200" } } })).id;
    await expect(
      db.$transaction((tx) => postJournal(tx, { entityId: e.id, date: dateOnly(2023, 1, 31), kind: "ADJUSTMENT", memo: "x", lines: [{ accountId: bank, debit: 5n, fx: { currency: "USD", amount: 1n, rate: "1.34", revaluation: true } }, { accountId: fx, credit: 5n }] })),
    ).rejects.toThrow(/nominal valas harus 0/);
  });
});
