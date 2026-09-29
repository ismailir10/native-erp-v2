import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { MockProvider } from "@/lib/ai/provider";
import { suggestAgainWithAi } from "@/lib/ai/retry";
import { aiFailureNote } from "@/lib/ai/classify";
import { dateOnly } from "@/lib/format";

describe("Minta saran AI on Review", () => {
  beforeEach(resetDb);

  it("asks only for lines that have the simple guess, updates their suggestion, posts nothing", async () => {
    const g = await makeGroup();
    const bank = g.pt.banks[0];
    const date = dateOnly(2026, 6, 3);
    const imp = await db.statementImport.create({ data: { firmId: g.firm.id, bankAccountId: bank.id, fileName: "s.pdf", format: "BCA", periodStart: date, periodEnd: date, openingBalance: 0n, closingBalance: 0n, rowCount: 5, continuityOk: true } });
    const tx = (hash: string, description: string, merchantKey: string, extra: Record<string, unknown> = {}) =>
      db.bankTransaction.create({ data: { firmId: g.firm.id, entityId: g.pt.entity.id, bankAccountId: bank.id, importId: imp.id, date, description, merchantKey, direction: "OUT", amount: -1_000_000n, rowNumber: 1, rawRow: "synthetic", hash, status: "NEEDS_REVIEW", method: "HEURISTIC", confidence: 0.3, reason: "Tebakan sederhana: uang keluar dianggap beban umum", suggestedCode: "6190", accountCode: "1999", ...extra } });
    const a = await tx("a", "TRSF KE TOKO ABC", "TOKO ABC");
    const b = await tx("b", "TRSF KE TOKO ABC 2", "TOKO ABC");
    const loan = await tx("c", "ANGSURAN PINJAMAN", "ANGSURAN PINJAMAN", { suggestedCode: "2210", reason: "Angsuran pokok pinjaman" });
    const ai = await tx("d", "TOKO XYZ", "TOKO XYZ", { method: "AI", suggestedCode: "6150" });
    const done = await tx("e", "TOKO ABC LAMA", "TOKO ABC", { status: "REVIEWED", accountCode: "6190" });

    const provider = new MockProvider({ "TOKO ABC": { accountCode: "6160", confidence: 0.9, taxTag: null, reason: "Perlengkapan toko" } });
    const r = await suggestAgainWithAi(db, { clientId: g.client.id, entityIds: [g.pt.entity.id], through: dateOnly(2026, 6, 30), provider });
    expect([r.rows, r.updated, r.calls, provider.calls]).toEqual([2, 2, 1, 1]); // one unique key, one call
    for (const id of [a.id, b.id]) {
      const t = await db.bankTransaction.findUniqueOrThrow({ where: { id } });
      expect([t.status, t.method, t.suggestedCode, t.accountCode, t.reason]).toEqual(["NEEDS_REVIEW", "AI", "6160", "1999", "AI: Perlengkapan toko"]);
    }
    for (const [id, method, code] of [[loan.id, "HEURISTIC", "2210"], [ai.id, "AI", "6150"], [done.id, "HEURISTIC", "6190"]] as const) {
      const t = await db.bankTransaction.findUniqueOrThrow({ where: { id } });
      expect([t.method, t.suggestedCode]).toEqual([method, code]);
    }
    expect(await db.journalEntry.count()).toBe(0);
    expect(await db.aiUsage.count()).toBe(1);

    // Nothing left to ask: no call.
    const again = await suggestAgainWithAi(db, { clientId: g.client.id, entityIds: [g.pt.entity.id], through: dateOnly(2026, 6, 30), provider });
    expect([again.rows, provider.calls]).toEqual([0, 1]);
  });

  it("says in Bahasa that the AI timed out", () => {
    expect(aiFailureNote(new DOMException("The operation was aborted due to timeout", "TimeoutError"))).toBe(
      "AI tidak menjawab dalam 90 detik, jadi transaksinya memakai tebakan sederhana. Minta saran AI lagi dari halaman Review.",
    );
    expect(aiFailureNote(new Error("AI 500: boom"))).toBe("AI gagal: AI 500: boom");
  });
});
