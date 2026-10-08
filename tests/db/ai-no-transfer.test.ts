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

describe("AI never guesses a line that names no one", () => {
  beforeEach(resetDb);

  it("keeps a counterparty-less line on the simple guess with the client question, and asks only about named lines", async () => {
    const { importStatement } = await import("@/lib/import/pipeline");
    const { toBriCsv } = await import("@/lib/demo/writers");
    const g = await makeGroup();
    const bank = g.owner.banks[0];
    const d = (day: number) => new Date(Date.UTC(2026, 4, day));
    const csv = toBriCsv({ bank: "BRI", accountNumber: "3333333333", holder: "Andi Wijaya", year: 2026, month: 5, opening: 10_000_000n, rows: [
      { date: d(18), description: "Cr BI fast Incoming - BI Fast Incoming", amount: 2_500_000n },
      { date: d(19), description: "DEBIT TOKO EMAS ANTAM", amount: -1_300_000n },
    ] });
    const asked: string[] = [];
    const provider = new MockProvider({ "DEBIT TOKO EMAS ANTAM": { accountCode: "3300", confidence: 0.6, taxTag: null, reason: "pemakaian pribadi" } });
    const classify = provider.classify.bind(provider);
    provider.classify = async (items: AiItem[]) => { asked.push(...items.map((i) => i.key)); return classify(items); };
    await importStatement(db, { bankAccountId: bank.id, fileName: "bri.csv", data: Buffer.from(csv), provider });
    expect(asked).toEqual(["DEBIT TOKO EMAS ANTAM"]); // the nameless line is never sent
    const nameless = await db.bankTransaction.findFirstOrThrow({ where: { bankAccountId: bank.id, description: { contains: "Incoming" } } });
    expect(nameless).toMatchObject({ method: "HEURISTIC", status: "NEEDS_REVIEW" });
    expect(nameless.reason).toMatch(/^Keterangan bank tidak menyebut pihak lawan, tanyakan ke klien\./);
  });
});
