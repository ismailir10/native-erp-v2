import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { completenessMatrix } from "@/lib/controls/completeness";
import { dateOnly } from "@/lib/format";

/** UC-B4: one view of every bank account × month — ada, bolong, or tidak nyambung with the difference. */
describe("kelengkapan rekening koran", () => {
  beforeEach(resetDb);

  it("marks a missing month, a broken handover with its difference, a break inside a file, and nothing before the books start", async () => {
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
    expect(months.map((m) => m.month)).toEqual([3, 4, 5, 6, 7, 8]);
    const row = rows.find((r) => r.bankAccountId === bca.id)!;
    expect(row.cells.map((c) => c.state)).toEqual(["before", "ok", "missing", "broken", "broken", "missing"]);
    expect(row.cells[3]).toMatchObject({ diff: 160n, note: "Saldo awal bca-6.csv tidak sama dengan saldo akhir bca-4.csv" });
    expect(row.cells[4]).toMatchObject({ diff: null, note: "bca-7.csv: baris 7: saldo tidak nyambung" });
    // Accounts with no statement and no Saldo Awal have nothing to show yet.
    expect(rows.map((r) => r.bankAccountId)).toEqual([bca.id]);
  });
});
