import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { db, makeGroup, resetDb } from "../helpers";
import { importSourceAccounts, postImport, stageImport } from "@/lib/ledger-import/post";
import { acceptMappings, suggestMappings } from "@/lib/ledger-import/mapping";
import { balanceSheet, trialBalanceMovement } from "@/lib/reports/ledger";
import { clientAccountsByAccount, sourceTrialBalance } from "@/lib/reports/source";
import { postJournal } from "@/lib/ledger/post";
import { accountLedger, sourceLedgerBasis } from "@/lib/reports/account-ledger";
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

  it("reads a client account's ledger by the accounts its lines were posted to, not a later remap", async () => {
    const { g, kas } = await postedGl();
    const ledger = async () => {
      const src = await db.sourceAccount.findUniqueOrThrow({ where: { id: kas.id }, include: { account: true } });
      const basis = await sourceLedgerBasis(db, src);
      return { basis, ...(await accountLedger(db, { sourceAccountId: kas.id, entityIds: [g.pt.entity.id], start: dateOnly(2026, 1, 1), end: dateOnly(2026, 1, 31), ...basis })) };
    };
    expect((await ledger()).basis).toEqual({ normalBalance: "DEBIT", isPL: false });
    // Remapped (for a later file) to an expense, then to a liability: the posted cash lines still read as cash.
    for (const code of ["6180", "2110"]) {
      const to = await db.account.findUniqueOrThrow({ where: { clientId_code: { clientId: g.client.id, code } } });
      await db.sourceAccount.update({ where: { id: kas.id }, data: { accountId: to.id } });
      const l = await ledger();
      expect(l.basis).toEqual({ normalBalance: "DEBIT", isPL: false });
      expect(l.opening).toBe(1000n); // December's cash isn't dropped as last year's income
      expect(l.rows.map((r) => r.balance)).toEqual(["1500", "1700"]); // nor turned negative
    }
    // Posted first to a contra asset (1219, credit side), then to a regular asset: the earliest posted account decides the side.
    const acc = async (code: string) => (await db.account.findUniqueOrThrow({ where: { clientId_code: { clientId: g.client.id, code } } })).id;
    const contra = await db.sourceAccount.create({ data: { firmId: g.firm.id, clientId: g.client.id, entityId: g.pt.entity.id, code: "12900", name: "Akumulasi Penyusutan" } });
    const { postJournal } = await import("@/lib/ledger/post");
    await db.$transaction(async (tx) => {
      await postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 1, 5), kind: "ADJUSTMENT", memo: "Penyusutan", lines: [{ accountId: await acc("6180"), debit: 100n }, { accountId: await acc("1219"), credit: 100n, sourceAccountId: contra.id }] });
      await postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 1, 25), kind: "ADJUSTMENT", memo: "Salah akun", lines: [{ accountId: await acc("1210"), credit: 10n, sourceAccountId: contra.id }, { accountId: await acc("6180"), debit: 10n }] });
    });
    expect(await sourceLedgerBasis(db, { ...contra, account: null })).toEqual({ normalBalance: "CREDIT", isPL: false });
    // A file type that matches no posted account still takes the earliest posted one, never a type of its own.
    expect(await sourceLedgerBasis(db, { ...contra, typeHint: "BEBAN", account: null })).toEqual({ normalBalance: "CREDIT", isPL: false });

    // Posted to two types (asset, then liability) under a file type matching neither: the earliest posted account decides, so the
    // ledger doesn't restart in January as an income statement account.
    const mixed = await db.sourceAccount.create({ data: { firmId: g.firm.id, clientId: g.client.id, entityId: g.pt.entity.id, code: "19000", name: "Rupa-rupa", typeHint: "BEBAN" } });
    await db.$transaction(async (tx) => {
      await postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2025, 12, 5), kind: "ADJUSTMENT", memo: "Uang muka", lines: [{ accountId: await acc("1110"), debit: 50n, sourceAccountId: mixed.id }, { accountId: await acc("2110"), credit: 50n }] });
      await postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 1, 6), kind: "ADJUSTMENT", memo: "Pindah", lines: [{ accountId: await acc("1110"), debit: 5n }, { accountId: await acc("2110"), credit: 5n, sourceAccountId: mixed.id }] });
    });
    expect(await sourceLedgerBasis(db, { ...mixed, account: null })).toEqual({ normalBalance: "DEBIT", isPL: false });

    // A client account with nothing posted follows its current mapping.
    const empty = await db.sourceAccount.create({ data: { firmId: g.firm.id, clientId: g.client.id, entityId: g.pt.entity.id, code: "41000", name: "Pendapatan Lain", typeHint: "PENDAPATAN" } });
    expect(await sourceLedgerBasis(db, { ...empty, account: null })).toEqual({ normalBalance: "CREDIT", isPL: true });
  });

  it("presents a client account posted to several Buku accounts under the one its ledger reads by", async () => {
    const { g } = await postedGl();
    const pt = g.pt.entity.id;
    const acc = async (code: string) => (await db.account.findUniqueOrThrow({ where: { clientId_code: { clientId: g.client.id, code } } })).id;
    const src = (code: string) => db.sourceAccount.create({ data: { firmId: g.firm.id, clientId: g.client.id, entityId: pt, code, name: `Rupa-rupa ${code}` } });
    // Two client accounts, each posted first to one Buku account and later to another, in opposite orders.
    const [x, y] = [await src("19001"), await src("19002")];
    await db.$transaction(async (tx) => {
      const line = async (sourceAccountId: string, code: string, date: Date, amount: bigint) =>
        postJournal(tx, { entityId: pt, date, kind: "ADJUSTMENT", memo: "uji", lines: [{ accountId: await acc(code), debit: amount, sourceAccountId }, { accountId: await acc("3100"), credit: amount }] });
      await line(x.id, "2110", dateOnly(2025, 12, 1), 10n);
      await line(x.id, "1110", dateOnly(2026, 1, 5), 20n);
      await line(y.id, "1110", dateOnly(2025, 12, 1), 10n);
      await line(y.id, "2110", dateOnly(2026, 1, 5), 20n);
      await line(x.id, "6180", dateOnly(2026, 2, 3), 5n); // after the report date: not part of the January TB
    });
    const tb = await sourceTrialBalance(db, pt, dateOnly(2026, 1, 31));
    const row = (id: string) => tb.find((r) => r.sourceAccountId === id)!;
    expect([row(x.id).accountCode, row(x.id).type, row(x.id).net]).toEqual(["2110", "LIABILITAS", 30n]);
    expect([row(y.id).accountCode, row(y.id).type, row(y.id).net]).toEqual(["1110", "ASET", 30n]);
    // The same basis as its ledger.
    expect((await sourceLedgerBasis(db, { ...x, account: null })).normalBalance).toBe("CREDIT");

    // A client account typed ASET in its file, posted to 2110 before the report date and to 1110 only after it: the January TB row
    // and the January ledger both read by 2110, never by the later account.
    const z = await db.sourceAccount.create({ data: { firmId: g.firm.id, clientId: g.client.id, entityId: pt, code: "19003", name: "Rupa-rupa 19003", typeHint: "ASET" } });
    await db.$transaction(async (tx) => {
      const line = async (code: string, date: Date) =>
        postJournal(tx, { entityId: pt, date, kind: "ADJUSTMENT", memo: "uji", lines: [{ accountId: await acc(code), debit: 7n, sourceAccountId: z.id }, { accountId: await acc("3100"), credit: 7n }] });
      await line("2110", dateOnly(2025, 12, 2));
      await line("2110", dateOnly(2026, 1, 6));
      await line("1110", dateOnly(2026, 2, 4));
    });
    const jan = (await sourceTrialBalance(db, pt, dateOnly(2026, 1, 31))).find((r) => r.sourceAccountId === z.id)!;
    expect([jan.accountCode, jan.type]).toEqual(["2110", "LIABILITAS"]);
    expect(await sourceLedgerBasis(db, { ...z, account: null }, dateOnly(2026, 1, 31))).toEqual({ normalBalance: "CREDIT", isPL: false });
    expect(await sourceLedgerBasis(db, { ...z, account: null }, dateOnly(2026, 2, 28))).toEqual({ normalBalance: "DEBIT", isPL: false }); // by then 1110 matches the file's type
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
