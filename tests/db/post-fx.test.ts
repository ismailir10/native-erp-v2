import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { LedgerError, postJournal } from "@/lib/ledger/post";
import { dateOnly } from "@/lib/format";

async function acc(clientId: string, code: string) {
  return (await db.account.findUniqueOrThrow({ where: { clientId_code: { clientId, code } } })).id;
}

describe("postJournal: source accounts, refs and foreign-currency lines", () => {
  beforeEach(resetDb);

  it("new clients get 3900 / 7190 / 7200", async () => {
    const g = await makeGroup();
    const codes = (await db.account.findMany({ where: { clientId: g.client.id, code: { in: ["3900", "7190", "7200"] } } })).map((a) => a.code).sort();
    expect(codes).toEqual(["3900", "7190", "7200"]);
  });

  it("keeps ledger import refs and source accounts on lines", async () => {
    const g = await makeGroup();
    const src = await db.sourceAccount.create({
      data: { firmId: g.firm.id, clientId: g.client.id, entityId: g.pt.entity.id, code: "10000", name: "Petty Cash", accountId: await acc(g.client.id, "1110") },
    });
    const equity = await acc(g.client.id, "3100");
    const entry = await db.$transaction((tx) =>
      postJournal(tx, {
        entityId: g.pt.entity.id,
        date: dateOnly(2026, 1, 31),
        kind: "IMPORTED",
        memo: "Impor",
        sourceRef: "GL!5-6",
        lines: [
          { accountId: src.accountId!, sourceAccountId: src.id, sourceRef: "GL!5", debit: 1000n },
          { accountId: equity, sourceRef: "GL!6", credit: 1000n },
        ],
      }),
    );
    expect(entry.sourceRef).toBe("GL!5-6");
    expect(entry.lines.find((l) => l.debit > 0n)?.sourceAccountId).toBe(src.id);
  });

  it("rejects a source account of another entity", async () => {
    const g = await makeGroup();
    const src = await db.sourceAccount.create({ data: { firmId: g.firm.id, clientId: g.client.id, entityId: g.owner.entity.id, code: "X", name: "X" } });
    await expect(
      db.$transaction(async (tx) =>
        postJournal(tx, {
          entityId: g.pt.entity.id,
          date: dateOnly(2026, 1, 31),
          kind: "IMPORTED",
          memo: "x",
          lines: [
            { accountId: await acc(g.client.id, "1110"), sourceAccountId: src.id, debit: 1n },
            { accountId: await acc(g.client.id, "3100"), credit: 1n },
          ],
        }),
      ),
    ).rejects.toThrow(LedgerError);
  });

  it("checks fx amount × rate against the functional amount (SGD entity, USD line)", async () => {
    const g = await makeGroup();
    await db.entity.update({ where: { id: g.pt.entity.id }, data: { functionalCurrency: "SGD" } });
    const bank = await acc(g.client.id, "1110");
    const loan = await acc(g.client.id, "2210");
    const post = (functional: bigint) =>
      db.$transaction((tx) =>
        postJournal(tx, {
          entityId: g.pt.entity.id,
          date: dateOnly(2023, 1, 3),
          kind: "IMPORTED",
          memo: "Loan USD 150,000 @ 1.31",
          lines: [
            { accountId: bank, debit: functional, fx: { currency: "USD", amount: 15_000_000n, rate: "1.31" } },
            { accountId: loan, credit: functional },
          ],
        }),
      );
    await expect(post(15_000_000n)).rejects.toThrow(/kurs 1.31/);
    const ok = await post(19_650_000n);
    const line = ok.lines.find((l) => l.debit > 0n)!;
    expect([line.currency, line.fxAmount, line.fxRate]).toEqual(["USD", 15_000_000n, "1.31"]);
  });

  it("rejects fx lines in the functional currency and DB-checks fx fields together", async () => {
    const g = await makeGroup();
    const bank = await acc(g.client.id, "1110");
    const eq = await acc(g.client.id, "3100");
    await expect(
      db.$transaction((tx) =>
        postJournal(tx, {
          entityId: g.pt.entity.id,
          date: dateOnly(2026, 1, 3),
          kind: "IMPORTED",
          memo: "x",
          lines: [
            { accountId: bank, debit: 100n, fx: { currency: "IDR", amount: 100n, rate: "1" } },
            { accountId: eq, credit: 100n },
          ],
        }),
      ),
    ).rejects.toThrow(/selain mata uang fungsional/);
    const entry = await db.$transaction((tx) =>
      postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 1, 3), kind: "IMPORTED", memo: "x", lines: [{ accountId: bank, debit: 5n }, { accountId: eq, credit: 5n }] }),
    );
    await expect(db.journalLine.update({ where: { id: entry.lines[0].id }, data: { fxAmount: 5n } })).rejects.toThrow();
  });
});
