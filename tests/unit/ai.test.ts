import { describe, expect, it } from "vitest";
import { buildPrompt, OpenAiCompatibleProvider, parseAiResponse } from "@/lib/ai/provider";

const items = [
  { key: "CV SUMBER VAKSIN", direction: "OUT" as const, sample: "TRSF CV SUMBER VAKSIN" },
  { key: "PT LOGISTIK CEPAT", direction: "OUT" as const, sample: "TRSF PT LOGISTIK CEPAT" },
];
const codes = new Set(["5100", "6140"]);

describe("AI response parsing (prompt-injection safe)", () => {
  it("keeps only known keys and whitelisted codes", () => {
    const text = `Berikut hasilnya: {"items":[{"k":"CV SUMBER VAKSIN","code":"5100","conf":0.8,"tax":"PPN_MASUKAN","why":"obat ternak"},{"k":"PT LOGISTIK CEPAT","code":"9999","conf":1},{"k":"EVIL","code":"6140","conf":1}]}`;
    const out = parseAiResponse(text, items, codes);
    expect(out).toEqual([{ key: "CV SUMBER VAKSIN", accountCode: "5100", confidence: 0.8, taxTag: "PPN_MASUKAN", reason: "obat ternak" }]);
  });
  it("returns [] on malformed JSON instead of throwing", () => {
    expect(parseAiResponse("not json {", items, codes)).toEqual([]);
  });
  it("prompt is compact: one line per account and item", () => {
    const { user } = buildPrompt(items, [{ code: "5100", name: "Pembelian" }], "Grup Uji");
    expect(user.split("\n").length).toBe(1 + 1 + 1 + 1 + items.length);
  });
});

describe("OpenAiCompatibleProvider", () => {
  it("calls /chat/completions once and maps usage", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(
        JSON.stringify({ model: "m1", usage: { prompt_tokens: 120, completion_tokens: 30 }, choices: [{ message: { content: '{"items":[{"k":"PT LOGISTIK CEPAT","code":"6140","conf":0.9,"tax":null,"why":"ongkir"}]}' } }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const p = new OpenAiCompatibleProvider({ baseUrl: "https://gw.test/v1", apiKey: "k", model: "m1", maxCallsPerImport: 3, monthlyTokenBudget: 1000 }, fakeFetch);
    const res = await p.classify(items, [{ code: "6140", name: "Logistik" }], "x");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://gw.test/v1/chat/completions");
    expect(calls[0].body.temperature).toBe(0);
    expect(res.answers[0].accountCode).toBe("6140");
    expect(res.promptTokens).toBe(120);
  });
});
