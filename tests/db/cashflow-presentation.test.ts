import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { dateOnly } from "@/lib/format";
import { balanceSheet } from "@/lib/reports/ledger";
import { cashFlow } from "@/lib/reports/statements";
import { statementSet } from "@/lib/reports/statement-set";

/**
 * Arus Kas as a partner presents it: a loan given to a related party is investing, a loan received is financing (by the 1190 balance's side
 * at the period end); the exported statement names lines without account codes, profit → Penyesuaian → Perubahan modal kerja.
 */
describe("cash flow presentation", () => {
  beforeEach(resetDb);

  async function books(icDebit: boolean) {
    const g = await makeGroup();
    const id = async (code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
    const bank = g.pt.banks[0].accountId;
    const post = (date: Date, lines: [string, bigint, bigint][]) =>
      db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date, kind: "ADJUSTMENT", memo: "uji", lines: await Promise.all(lines.map(async ([c, d, k]) => ({ accountId: c === "bank" ? bank : await id(c), debit: d, credit: k }))) }));
    await post(dateOnly(2026, 1, 5), [["bank", 500_000_000n, 0n], ["3100", 0n, 500_000_000n]]);
    await post(dateOnly(2026, 2, 10), [["1130", 80_000_000n, 0n], ["4100", 0n, 80_000_000n]]);
    await post(dateOnly(2026, 3, 31), [["6180", 5_000_000n, 0n], ["1219", 0n, 5_000_000n]]);
    // 1190: money lent to the owner (debit) or borrowed from them (credit).
    await post(dateOnly(2026, 4, 15), icDebit ? [["1190", 197_000_000n, 0n], ["bank", 0n, 197_000_000n]] : [["bank", 50_000_000n, 0n], ["1190", 0n, 50_000_000n]]);
    return { clientId: g.client.id, entityIds: [g.pt.entity.id] };
  }

  it("a debit 1190 is a loan given (investing), a credit 1190 a loan received (financing); the sections still add up to the change in cash", async () => {
    for (const lent of [true, false]) {
      const scope = await books(lent);
      const cf = await cashFlow(db, scope, dateOnly(2026, 6, 30));
      const bs = await balanceSheet(db, scope, dateOnly(2026, 6, 30));
      if (lent) {
        expect(cf.investing).toEqual([{ key: "INTERCOMPANY_LENT", label: "Pinjaman kepada pihak berelasi", amount: -197_000_000n, codes: ["1190"] }]);
        expect(cf.financing.map((i) => i.key)).not.toContain("INTERCOMPANY");
      } else {
        expect(cf.financing).toContainEqual({ key: "INTERCOMPANY", label: "Pinjaman dari pihak berelasi", amount: 50_000_000n, codes: ["1190"] });
        expect(cf.investing).toEqual([]);
      }
      expect(cf.closingCash).toBe(bs.currentAssets.find((i) => i.fsLine === "KAS_SETARA_KAS")!.amount);
      expect(cf.openingCash + cf.net).toBe(cf.closingCash);
      await resetDb();
    }
  });

  it("the exported statement: no account codes, profit then Penyesuaian then Perubahan modal kerja", async () => {
    const scope = await books(true);
    const ak = (await statementSet(db, scope, 2026, 6)).statements.find((s) => s.name === "Arus Kas")!;
    const labels = ak.rows.map((r) => r.label);
    expect(labels.some((l) => /\(\d{4}/.test(l))).toBe(false);
    const at = (l: string) => labels.indexOf(l);
    expect(at("Laba bersih")).toBeLessThan(at("Penyesuaian:"));
    expect(at("Penyesuaian:")).toBeLessThan(at("Penyusutan dan amortisasi"));
    expect(at("Penyusutan dan amortisasi")).toBeLessThan(at("Perubahan modal kerja:"));
    expect(at("Perubahan modal kerja:")).toBeLessThan(at("Piutang usaha"));
    expect(at("Piutang usaha")).toBeLessThan(at("Kas bersih dari aktivitas operasi"));
    expect(ak.rows.find((r) => r.label === "Pinjaman kepada pihak berelasi")!.values).toEqual([-197_000_000n]);
  });
});
