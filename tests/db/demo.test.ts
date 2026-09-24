import { describe, expect, it } from "vitest";
import { db } from "../helpers";
import { liveUploadFile, seedDemo } from "@/lib/demo/seed";
import { verifyBooks } from "@/lib/demo/verify";
import { importStatement } from "@/lib/import/pipeline";
import { runControls } from "@/lib/controls";
import { MockProvider } from "@/lib/ai/provider";

/** Layer 2: the seeded demo (built through the real pipeline) matches generator ground truth. */
describe("demo seed vs ground truth", () => {
  it("seeds, verifies ALL PASS, and the live upload clears the pending controls with 0 AI calls", async () => {
    await seedDemo(db);
    const before = await verifyBooks(db);
    expect(before.failures).toEqual([]);
    expect(before.checks).toBeGreaterThan(900);

    const client = await db.client.findFirstOrThrow({ where: { name: "Grup Ayam Nusantara" } });
    const c0 = Object.fromEntries((await runControls(db, client.id, 2026, 8)).map((c) => [c.key, c.status]));
    expect(c0.intercompany).toBe("REVIEW");

    const bri = await db.bankAccount.findFirstOrThrow({ where: { number: "012301004455509" } });
    const f = await liveUploadFile();
    const provider = new MockProvider({});
    const s = await importStatement(db, { bankAccountId: bri.id, fileName: f.fileName, data: f.data, provider });
    expect(provider.calls).toBe(0); // everything resolved by transfer/memory/cache
    expect(s.needsReview).toBe(1); // the new pharmacy merchant (cached AI suggestion)

    const after = Object.fromEntries((await runControls(db, client.id, 2026, 8)).map((c) => [c.key, c.status]));
    expect(after.intercompany).toBe("PASS");
    expect(after[`bank:${bri.id}`]).toBe("PASS");
    expect((await verifyBooks(db, { includeLive: true })).failures).toEqual([]);
  }, 120_000);
});
