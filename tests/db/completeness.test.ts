import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { completenessMatrix } from "@/lib/controls/completeness";
import { dateOnly } from "@/lib/format";

/** UC-B4: one view of every bank account × month — ada, bolong, or tidak nyambung with the difference. */
describe("kelengkapan rekening koran", () => {
  beforeEach(resetDb);

  it("marks a missing month, a broken handover with its difference, a break inside a file, and shows no month before the books start", async () => {
    const g = await makeGroup();
    const bca = g.pt.banks[0];
    const stmt = (m: number, opening: bigint, closing: bigint, continuityOk = true) =>
      db.statementImport.create({
        data: { firmId: g.firm.id, bankAccountId: bca.id, fileName: `bca-${m}.csv`, format: "BCA", periodStart: dateOnly(2026, m, 1), periodEnd: dateOnly(2026, m + 1, 0), openingBalance: opening, closingBalance: closing, rowCount: 3, continuityOk, continuityNote: continuityOk ? null : "baris 7: saldo tidak nyambung" },
      });
    await stmt(4, 100n, 150n);
    // May never imported; June starts at 310 although April ended at 150: something between is missing.
    await stmt(6, 310n, 320n);
    await stmt(7, 320n, 300n, false);

    const { months, rows } = await completenessMatrix(db, g.client.id, 2026, 8, 6);
    // March is before any book starts: no column for it.
    expect(months.map((m) => m.month)).toEqual([4, 5, 6, 7, 8]);
    const row = rows.find((r) => r.bankAccountId === bca.id)!;
    expect(row.cells.map((c) => c.state)).toEqual(["ok", "missing", "broken", "broken", "missing"]);
    expect(row.cells[2]).toMatchObject({ diff: 160n, note: "Saldo awal bca-6.csv tidak sama dengan saldo akhir bca-4.csv" });
    expect(row.cells[3]).toMatchObject({ diff: null, note: "bca-7.csv: baris 7: saldo tidak nyambung" });
    // Accounts with no statement and no Saldo Awal have nothing to show yet.
    expect(rows.map((r) => r.bankAccountId)).toEqual([bca.id]);
  });

  it("checks every statement of a month against the one before it, and doesn't compare a file that starts inside another", async () => {
    const g = await makeGroup();
    const bca = g.pt.banks[0];
    const stmt = (name: string, from: Date, to: Date, opening: bigint, closing: bigint) =>
      db.statementImport.create({ data: { firmId: g.firm.id, bankAccountId: bca.id, fileName: name, format: "BCA", periodStart: from, periodEnd: to, openingBalance: opening, closingBalance: closing, rowCount: 3, continuityOk: true } });
    await stmt("apr.csv", dateOnly(2026, 4, 1), dateOnly(2026, 4, 30), 100n, 150n);
    // May in two halves: the second doesn't start where the first ended.
    await stmt("mei-1.csv", dateOnly(2026, 5, 1), dateOnly(2026, 5, 15), 150n, 170n);
    await stmt("mei-2.csv", dateOnly(2026, 5, 16), dateOnly(2026, 5, 31), 175n, 180n);
    // June, plus a file from mid-June to mid-July that overlaps it: its opening is mid-June's, not comparable.
    await stmt("jun.csv", dateOnly(2026, 6, 1), dateOnly(2026, 6, 30), 180n, 200n);
    await stmt("jun-jul.csv", dateOnly(2026, 6, 15), dateOnly(2026, 7, 15), 190n, 210n);
    const row = (await completenessMatrix(db, g.client.id, 2026, 7, 4)).rows[0];
    expect(row.cells.map((c) => c.state)).toEqual(["ok", "broken", "ok", "ok"]);
    expect(row.cells[1]).toMatchObject({ diff: 5n, note: "Saldo awal mei-2.csv tidak sama dengan saldo akhir mei-1.csv" });
  });
});
