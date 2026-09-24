import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { AiBudgetError, reserveAiBudget, runBudgetedAi, settleAiBudget } from "@/lib/ai/budget";
import { MockProvider } from "@/lib/ai/provider";
import { suggestWithAi } from "@/lib/ai/classify";

describe("AI reservations", () => {
  beforeEach(resetDb);
  afterEach(() => vi.unstubAllEnvs());
  it("serializes concurrent monthly reservations so only one paid call fits", async () => {
    const { firm } = await makeGroup();
    const args = { firmId: firm.id, scope: "intake:1", prompt: { system: "", user: "" }, maxCompletionTokens: 744, monthlyTokenBudget: 1500 };
    const results = await Promise.allSettled([reserveAiBudget(db, args), reserveAiBudget(db, { ...args, scope: "question:1" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((r) => r.status === "rejected");
    expect(failure?.status === "rejected" && failure.reason).toBeInstanceOf(AiBudgetError);
    expect(await db.aiReservation.count()).toBe(1);
  });
  it("settles once, releases unused tokens, and counts scope across calls", async () => {
    const { firm } = await makeGroup();
    const args = { firmId: firm.id, scope: "question:1", prompt: { system: "", user: "" }, maxCompletionTokens: 744, monthlyTokenBudget: 10000, scopeTokenLimit: 1200 };
    const reservation = await reserveAiBudget(db, args);
    const settlement = { usage: { model: "mock", promptTokens: 100, completionTokens: 50 }, model: "mock", ok: true };
    await Promise.all([settleAiBudget(db, reservation, settlement), settleAiBudget(db, reservation, settlement)]);
    expect(await db.aiUsage.count()).toBe(1);
    await reserveAiBudget(db, args);
    await expect(reserveAiBudget(db, args)).rejects.toThrow(AiBudgetError);
    expect((await db.aiReservation.findUniqueOrThrow({ where: { id: reservation.id } })).tokens).toBe(150);
  });
  it("charges full reservation on unknown billing failures and never retries", async () => {
    const { firm } = await makeGroup();
    let calls = 0;
    const args = { firmId: firm.id, scope: "intake:1", prompt: { system: "", user: "" }, maxCompletionTokens: 744, monthlyTokenBudget: 1500, model: "m" };
    await expect(runBudgetedAi(db, args, async () => { calls++; throw new Error("timeout"); })).rejects.toThrow("timeout");
    await expect(runBudgetedAi(db, args, async () => { calls++; return { model: "m", promptTokens: 10, completionTokens: 10 }; })).rejects.toThrow(AiBudgetError);
    expect(calls).toBe(1);
    expect(await db.aiUsage.findFirst()).toMatchObject({ promptTokens: 1000, completionTokens: 0, ok: false });
  });
  it("budget exhaustion prevents existing classifier calls; a second client cannot read first client's cache", async () => {
    const g = await makeGroup();
    const provider = new MockProvider({ merchant: { accountCode: "5100", confidence: 0.8, reason: "source", taxTag: null } });
    const args = { firmId: g.firm.id, clientId: g.client.id, clientName: "one", coaVersion: 1, accounts: [{ code: "5100", name: "Pembelian" }], pending: [{ key: "merchant", direction: "OUT" as const, sample: "merchant" }], provider };
    vi.stubEnv("AI_MONTHLY_TOKEN_BUDGET", "10000");
    expect((await suggestWithAi(db, args)).usage.calls).toBe(1);
    expect((await suggestWithAi(db, args)).usage.cacheHits).toBe(1);
    vi.stubEnv("AI_MONTHLY_TOKEN_BUDGET", "1");
    const result = await suggestWithAi(db, { ...args, clientId: "another-client" });
    expect(result.suggestions.size).toBe(0);
    expect(result.usage.calls).toBe(0);
    expect(provider.calls).toBe(1);
  });
});
