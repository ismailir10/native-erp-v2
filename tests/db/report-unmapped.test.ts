import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { balanceSheet, incomeStatement } from "@/lib/reports/ledger";
import { reasonText, reportStatus } from "@/lib/reports/status";
import { dateOnly } from "@/lib/format";

/** UC-K3 trap: an account whose FS line doesn't fit its statement must never drop out of it. */
describe("statements never drop an account", () => {
  beforeEach(resetDb);

  it("shows an expense on a balance-sheet line and an asset on an unknown line, keeps both statements agreeing, and makes the report a draft", async () => {
    const g = await makeGroup();
    const acc = async (code: string) => (await db.account.findUniqueOrThrow({ where: { clientId_code: { clientId: g.client.id, code } } })).id;
    const oddExpense = await db.account.create({ data: { firmId: g.firm.id, clientId: g.client.id, code: "6990", name: "Beban Salah Baris", type: "BEBAN", fsLine: "KAS_SETARA_KAS", normalBalance: "DEBIT" } });
    const oddAsset = await db.account.create({ data: { firmId: g.firm.id, clientId: g.client.id, code: "1290", name: "Aset Baris Asing", type: "ASET", fsLine: "CUSTOM_LINE", normalBalance: "DEBIT" } });
    await db.$transaction(async (tx) => {
      await postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 3, 10), kind: "ADJUSTMENT", memo: "uji", lines: [{ accountId: oddExpense.id, debit: 7_000_000n }, { accountId: await acc("3100"), credit: 7_000_000n }] });
      await postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 3, 11), kind: "ADJUSTMENT", memo: "uji", lines: [{ accountId: oddAsset.id, debit: 40_000_000n }, { accountId: await acc("3100"), credit: 40_000_000n }] });
    });
    const scope = { clientId: g.client.id, entityIds: [g.pt.entity.id] };
    const is = await incomeStatement(db, scope, dateOnly(2026, 1, 1), dateOnly(2026, 3, 31));
    const bs = await balanceSheet(db, scope, dateOnly(2026, 3, 31));
    expect(is.other.find((i) => i.fsLine === "UNMAPPED_EXPENSE")).toMatchObject({ label: "Pos beban belum terpetakan", amount: -7_000_000n, accounts: [{ code: "6990", amount: -7_000_000n }] });
    expect(is.totals.netProfit).toBe(-7_000_000n);
    expect(bs.equity.find((i) => i.fsLine === "LABA_BERJALAN")!.amount).toBe(is.totals.netProfit);
    expect(bs.currentAssets.find((i) => i.fsLine === "UNMAPPED_ASSET")).toMatchObject({ label: "Pos aset belum terpetakan", amount: 40_000_000n });
    expect(bs.totals.difference).toBe(0n);

    const status = await reportStatus(db, g.client.id, [g.pt.entity.id], 2026, 3);
    const reason = status.reasons.find((r) => r.kind === "unmapped")!;
    expect(reasonText(reason)).toBe("akun belum terpetakan ke baris laporan: 1290 Aset Baris Asing, 6990 Beban Salah Baris");
  });
});
