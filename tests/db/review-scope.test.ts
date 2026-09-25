import { beforeEach, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { acceptSimilar } from "@/lib/review";
import { dateOnly } from "@/lib/format";

beforeEach(resetDb);
it("bulk review does not accept matching merchants outside selected company or cutoff", async () => {
  const g = await makeGroup();
  async function transaction(entity: typeof g.pt, month: number, hash: string) {
    const date = dateOnly(2026, month, 2);
    const imported = await db.statementImport.create({ data: { firmId: g.firm.id, bankAccountId: entity.banks[0].id, fileName: `${hash}.csv`, format: "BCA", periodStart: date, periodEnd: date, openingBalance: 100n, closingBalance: 90n, rowCount: 1, continuityOk: true } });
    return db.bankTransaction.create({ data: { firmId: g.firm.id, entityId: entity.entity.id, bankAccountId: entity.banks[0].id, importId: imported.id, date, description: "Contoh belanja", merchantKey: "TOKO CONTOH", direction: "OUT", amount: -10n, rowNumber: 1, rawRow: "synthetic", hash, status: "NEEDS_REVIEW", method: "HEURISTIC", confidence: 0.5, reason: "contoh", suggestedCode: "6190" } });
  }
  const selected = await transaction(g.pt, 8, "selected");
  const later = await transaction(g.pt, 9, "later");
  const otherEntity = await transaction(g.owner, 8, "other");
  expect(await acceptSimilar(db, selected.id, { entityIds: [g.pt.entity.id], through: dateOnly(2026, 8, 31) })).toBe(1);
  expect((await db.bankTransaction.findUniqueOrThrow({ where: { id: selected.id } })).status).toBe("REVIEWED");
  expect((await db.bankTransaction.findUniqueOrThrow({ where: { id: later.id } })).status).toBe("NEEDS_REVIEW");
  expect((await db.bankTransaction.findUniqueOrThrow({ where: { id: otherEntity.id } })).status).toBe("NEEDS_REVIEW");
  expect(await db.journalEntry.count({ where: { entityId: g.owner.entity.id } })).toBe(0);
});
