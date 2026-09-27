import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { db, makeGroup, resetDb } from "../helpers";
import { importSourceAccounts, postImport, stageImport } from "@/lib/ledger-import/post";
import { acceptMappings, suggestMappings } from "@/lib/ledger-import/mapping";
import { balanceSheet, trialBalanceMovement } from "@/lib/reports/ledger";
import { clientAccountsByAccount, sourceTrialBalance } from "@/lib/reports/source";
import { accountLedger } from "@/lib/reports/account-ledger";
import { dateOnly } from "@/lib/format";

/** A small client GL across a year end: cash, revenue and a long-term payable in the client's own codes. */
async function postedGl() {
  const g = await makeGroup();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("GL");
  ws.addRow(["Entity", "Entry Date", "Account Code", "Account Name", "Debit", "Credit"]);
  const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));
  ws.addRow(["PT Uji", d(2025, 12, 15), "10000", "Kas", 1000, 0]);
  ws.addRow(["PT Uji", d(2025, 12, 15), "40000", "Pendapatan Jasa", 0, 1000]);
  ws.addRow(["PT Uji", d(2026, 1, 10), "10000", "Kas", 500, 0]);
  ws.addRow(["PT Uji", d(2026, 1, 10), "25000", "Hutang Jangka Panjang Pemegang Saham", 0, 500]);
  ws.addRow(["PT Uji", d(2026, 1, 20), "10000", "Kas", 200, 0]);
  ws.addRow(["PT Uji", d(2026, 1, 20), "40000", "Pendapatan Jasa", 0, 200]);
  const st = await stageImport(db, { firmId: g.firm.id, clientId: g.client.id, fileName: "gl.xlsx", data: Buffer.from(await wb.xlsx.writeBuffer()) });
  if (st.status !== "STAGED") throw new Error("not staged");
  await suggestMappings(db, { firmId: g.firm.id, clientId: g.client.id, provider: null, useAi: false });
  const src = await importSourceAccounts(db, st.importId);
  await acceptMappings(db, g.client.id, src.map((x) => ({ sourceAccountId: x.id, accountCode: x.suggestedCode!, method: x.suggestedBy! })));
  await postImport(db, g.client.id, st.importId);
  const kas = await db.sourceAccount.findFirstOrThrow({ where: { entityId: g.pt.entity.id, code: "10000" }, include: { account: true } });
  return { g, kas };
}

describe("client COA-first reports", () => {
  beforeEach(resetDb);

  it("gives the month's movement per Buku account, folding last year's result into 3200", async () => {
    const { g } = await postedGl();
    const rows = await trialBalanceMovement(db, { clientId: g.client.id, entityIds: [g.pt.entity.id] }, dateOnly(2026, 1, 1), dateOnly(2026, 1, 31));
    const by = (code: string) => rows.find((r) => r.account.code === code)!;
    expect([by("1110").opening, by("1110").periodDebit, by("1110").periodCredit, by("1110").net]).toEqual([1000n, 700n, 0n, 1700n]);
    expect([by("4110").opening, by("4110").periodCredit, by("4110").net]).toEqual([0n, 200n, -200n]); // income restarts on 1 January
    expect([by("3200").opening, by("3200").net]).toEqual([-1000n, -1000n]); // 2025 profit
    expect(rows.reduce((s, r) => s + r.opening, 0n)).toBe(0n);
    expect(rows.reduce((s, r) => s + r.net, 0n)).toBe(0n);
  });

  it("shows the client's own accounts with movement, and each one's ledger down to the file row", async () => {
    const { g, kas } = await postedGl();
    const tb = await sourceTrialBalance(db, g.pt.entity.id, dateOnly(2026, 1, 31));
    const row = tb.find((r) => r.sourceAccountId === kas.id)!;
    expect([row.code, row.name, row.accountCode, row.opening, row.periodDebit, row.periodLines, row.net]).toEqual(["10000", "Kas", "1110", 1000n, 700n, 2, 1700n]);
    expect(tb.find((r) => r.key === "prior")?.net).toBe(-1000n);

    const ledger = await accountLedger(db, { sourceAccountId: kas.id, entityIds: [g.pt.entity.id], start: dateOnly(2026, 1, 1), end: dateOnly(2026, 1, 31), normalBalance: kas.account!.normalBalance, isPL: false });
    expect(ledger.opening).toBe(1000n);
    expect(ledger.rows.map((r) => [r.debit, r.balance])).toEqual([["500", "1500"], ["200", "1700"]]);
    expect(ledger.rows[0].fileSource).toMatchObject({ fileName: "gl.xlsx", lineRef: "GL!4", sourceAccount: "10000 Kas" });
  });

  it("breaks each Buku account into the client accounts behind it", async () => {
    const { g } = await postedGl();
    const parts = await clientAccountsByAccount(db, g.pt.entity.id, { to: dateOnly(2026, 1, 31) });
    expect(parts.get("1110")).toEqual([expect.objectContaining({ code: "10000", name: "Kas", net: 1700n })]);
    expect(parts.get("2300")).toEqual([expect.objectContaining({ code: "25000", net: -500n })]);
  });

  it("presents long-term liabilities in their own Neraca section", async () => {
    const { g } = await postedGl();
    const bs = await balanceSheet(db, { clientId: g.client.id, entityIds: [g.pt.entity.id] }, dateOnly(2026, 1, 31));
    expect(bs.currentLiabilities).toEqual([]);
    expect(bs.nonCurrentLiabilities.map((i) => [i.fsLine, i.amount])).toEqual([["UTANG_JANGKA_PANJANG", 500n]]);
    expect(bs.liabilities).toEqual([...bs.currentLiabilities, ...bs.nonCurrentLiabilities]);
    expect(bs.totals.difference).toBe(0n);
  });
});
