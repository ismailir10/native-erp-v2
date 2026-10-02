import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { MockProvider, type AiItem } from "@/lib/ai/provider";
import { aiCacheKey, suggestWithAi } from "@/lib/ai/classify";

/** UC-B2: transfers are paired by the matcher or decided by the reviewer; the model never sees or proposes 1190 or 1199. */
/** The mock answers from its table; this one also records the chart it was given (the real providers receive it as the 2nd argument). */
function recording(table: ConstructorParameters<typeof MockProvider>[0]) {
  const provider = new MockProvider(table) as MockProvider & { seen: string[] };
  const answer = provider.classify.bind(provider);
  provider.seen = [];
  (provider as unknown as { classify: (items: AiItem[], accounts: { code: string }[]) => ReturnType<MockProvider["classify"]> }).classify = (items, accounts) => {
    provider.seen = accounts.map((a) => a.code);
    return answer(items);
  };
  return provider;
}

describe("AI never proposes a transfer account", () => {
  beforeEach(resetDb);

  it("leaves 1190 and 1199 out of the chart it sends and drops an answer that names them", async () => {
    const g = await makeGroup();
    const accounts = (await db.account.findMany({ where: { clientId: g.client.id }, orderBy: { code: "asc" } })).map((a) => ({ code: a.code, name: a.name }));
    const provider = recording({ "KAWAN LAMA": { accountCode: "1199", confidence: 0.95, taxTag: null, reason: "Kelihatannya transfer" }, "TOKO BARU": { accountCode: "6160", confidence: 0.9, taxTag: null, reason: "Perlengkapan" } });
    const args = { firmId: g.firm.id, clientId: g.client.id, clientName: "Grup Uji", coaVersion: 1, accounts, provider };
    const r = await suggestWithAi(db, { ...args, pending: [{ key: "KAWAN LAMA", direction: "OUT", sample: "TRSF KAWAN LAMA" }, { key: "TOKO BARU", direction: "OUT", sample: "TOKO BARU" }] });
    expect(provider.seen).not.toContain("1199");
    expect(provider.seen).not.toContain("1190");
    expect(provider.seen).toContain("6160");
    expect(r.suggestions.has("KAWAN LAMA|OUT")).toBe(false);
    expect(r.suggestions.get("TOKO BARU|OUT")?.accountCode).toBe("6160");

    // A cached answer from before (on 1199) is not served either; the cache key no longer depends on the transfer accounts.
    const scope = { firmId: g.firm.id, clientId: g.client.id, model: "mock", clientName: "Grup Uji", sample: "TRSF KAWAN LAMA" };
    const key = aiCacheKey("KAWAN LAMA", "OUT", 1, { ...scope, accounts });
    expect(key).toBe(aiCacheKey("KAWAN LAMA", "OUT", 1, { ...scope, accounts: accounts.filter((a) => a.code !== "1199" && a.code !== "1190") }));
    await db.aiSuggestion.create({ data: { cacheKey: key, merchantKey: "KAWAN LAMA", direction: "OUT", accountCode: "1199", confidence: 0.95, taxTag: null, reason: "lama", model: "mock" } });
    const cached = await suggestWithAi(db, { ...args, provider: null, pending: [{ key: "KAWAN LAMA", direction: "OUT", sample: "TRSF KAWAN LAMA" }] });
    expect(cached.suggestions.size).toBe(0);
  });
});
