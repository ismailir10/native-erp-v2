import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { makePdf, table } from "../pdf-fixture";
import { importStatement } from "@/lib/import/pipeline";
import { reviewTransaction } from "@/lib/review";
import { cachedCloseReview, reviewClose } from "@/lib/controls/ai-review";
import { MockProvider, type AiProvider } from "@/lib/ai/provider";

const statement = makePdf([
  [
    ...table(800, [[[40, "PT Bank Mandiri (Persero) Tbk"]], [[40, "Nomor Rekening : 2222222222"]], [[40, "Periode : 01/08/2026 - 31/08/2026"]]]),
    ...table(740, [
      [[40, "Tanggal"], [130, "Keterangan"], [360, "Debit"], [440, "Kredit"], [520, "Saldo"]],
      [[40, "01/08/2026"], [130, "SALDO AWAL"], [500, "0,00"]],
      [[40, "04/08/2026"], [130, "PENCAIRAN PINJAMAN KMK"], [430, "100.000.000,00"], [510, "100.000.000,00"]],
    ]),
  ],
]);

async function flaggedMonth() {
  const g = await makeGroup();
  await importStatement(db, { bankAccountId: g.pt.banks[1].id, fileName: "mandiri.pdf", data: statement, provider: null });
  const tx = await db.bankTransaction.findFirstOrThrow({ where: { entityId: g.pt.entity.id } });
  await reviewTransaction(db, { bankTxId: tx.id, accountCode: tx.suggestedCode!, taxTag: null });
  return { g, tx };
}

describe("AI close review", () => {
  beforeEach(resetDb);

  it("explains flagged controls citing their rows, pays once, then serves the cache", async () => {
    const { g, tx } = await flaggedMonth();
    const provider = new MockProvider();
    const r = await reviewClose(db, g.firm.id, g.client.id, 2026, 8, provider);
    const financing = r.items.find((i) => i.controlKey === `pl-financing:${g.pt.entity.id}`)!;
    expect(financing.refs).toEqual([tx.id]);
    expect(financing.links[0].href).toBe(`/clients/${g.client.id}/ledger/4100?period=2026-08&entity=${g.pt.entity.id}`);
    expect(r.items.every((i) => i.status === "REVIEW" || i.status === "FAIL")).toBe(true);
    expect(provider.calls).toBe(1);

    const usage = await db.aiUsage.findMany();
    expect(usage.map((u) => [u.ok, u.model])).toEqual([[true, "mock"]]);
    expect(await db.aiReservation.count({ where: { settled: false } })).toBe(0);

    await reviewClose(db, g.firm.id, g.client.id, 2026, 8, provider);
    expect(provider.calls).toBe(1);
    expect((await cachedCloseReview(db, g.firm.id, g.client.id, 2026, 8, "mock"))?.items.length).toBe(r.items.length);
    expect(await cachedCloseReview(db, g.firm.id, g.client.id, 2026, 8, "other-model")).toBeNull();

    // The accountant reclassifies: the flagged set changes, the old review no longer applies.
    await reviewTransaction(db, { bankTxId: tx.id, accountCode: "2210", taxTag: null });
    expect(await cachedCloseReview(db, g.firm.id, g.client.id, 2026, 8, "mock")).toBeNull();
  });

  it("never posts, acks or locks", async () => {
    const { g } = await flaggedMonth();
    const before = { entries: await db.journalEntry.count(), acks: await db.controlAck.count(), signoffs: await db.closeSignoff.count() };
    await reviewClose(db, g.firm.id, g.client.id, 2026, 8, new MockProvider());
    expect({ entries: await db.journalEntry.count(), acks: await db.controlAck.count(), signoffs: await db.closeSignoff.count() }).toEqual(before);
    expect((await db.period.findFirst({ where: { clientId: g.client.id, year: 2026, month: 8 } }))?.status ?? "OPEN").toBe("OPEN");
  });

  it("logs a failed call and keeps nothing in the cache", async () => {
    const { g } = await flaggedMonth();
    const broken: AiProvider = { model: "broken", classify: async () => { throw new Error("x"); }, mapAccounts: async () => { throw new Error("x"); }, reviewClose: async () => { throw new Error("AI 500: down"); } };
    await expect(reviewClose(db, g.firm.id, g.client.id, 2026, 8, broken)).rejects.toThrow(/AI 500/);
    expect((await db.aiUsage.findMany()).map((u) => u.ok)).toEqual([false]);
    expect(await db.evidenceAiCache.count()).toBe(0);
  });
});
