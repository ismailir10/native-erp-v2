import { describe, expect, it } from "vitest";
import { fetchModels, SettingsError, validateAiInput } from "@/lib/settings/ai";

const fakeFetch = (status: number, body: unknown, seen: { url?: string; auth?: string } = {}) =>
  (async (url: string, init?: RequestInit) => {
    seen.url = url;
    seen.auth = (init?.headers as Record<string, string>)?.authorization;
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;

describe("Pengaturan AI input", () => {
  it("keeps the stored key when the field is empty", () => {
    expect(validateAiInput({ apiKey: "  ", model: " big-pickle " })).toEqual({ apiKey: undefined, model: "big-pickle" });
  });
  it("rejects keys with spaces and empty models", () => {
    expect(() => validateAiInput({ apiKey: "sk abc defgh", model: "m" })).toThrow(SettingsError);
    expect(() => validateAiInput({ apiKey: "", model: "" })).toThrow(/nama model/);
  });
});

describe("fetchModels (GET /models, no tokens)", () => {
  it("lists ids sorted and sends the key as bearer", async () => {
    const seen: { url?: string; auth?: string } = {};
    const ids = await fetchModels("https://opencode.ai/zen/v1", "sk-1", fakeFetch(200, { data: [{ id: "qwen" }, { id: "claude" }] }, seen));
    expect(ids).toEqual(["claude", "qwen"]);
    expect(seen).toEqual({ url: "https://opencode.ai/zen/v1/models", auth: "Bearer sk-1" });
  });
  it("turns a 401 into a Bahasa message", async () => {
    await expect(fetchModels("https://opencode.ai/zen/v1", "bad", fakeFetch(401, {}))).rejects.toThrow("Kunci ditolak");
  });
});
