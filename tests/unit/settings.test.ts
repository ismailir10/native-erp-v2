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
  it("refuses a Zen model Buku can't call, with models that work", () => {
    expect(() => validateAiInput({ apiKey: "", model: "gpt-5.6-luna" }, "https://opencode.ai/zen/v1")).toThrow(/tidak dilayani lewat \/chat\/completions.*glm-5\.3/);
    expect(validateAiInput({ apiKey: "", model: "glm-5.3" }, "https://opencode.ai/zen/v1").model).toBe("glm-5.3");
    expect(validateAiInput({ apiKey: "", model: "gpt-5.6-luna" }, "https://gw.example/v1").model).toBe("gpt-5.6-luna");
  });
});

describe("fetchModels (GET /models, no tokens)", () => {
  it("lists ids sorted and sends the key as bearer", async () => {
    const seen: { url?: string; auth?: string } = {};
    const ids = await fetchModels("https://opencode.ai/zen/v1", "sk-1", fakeFetch(200, { data: [{ id: "kimi-k3" }, { id: "glm-5.3" }] }, seen));
    expect(ids).toEqual(["glm-5.3", "kimi-k3"]);
    expect(seen).toEqual({ url: "https://opencode.ai/zen/v1/models", auth: "Bearer sk-1" });
  });
  it("on OpenCode Zen, hides models served on other endpoints; other gateways list everything", async () => {
    const data = { data: ["gpt-5.6-luna", "claude-sonnet-5", "qwen3.7-max", "gemini-3.8-flash", "grok-4.7", "glm-5.3", "deepseek-v4-pro"].map((id) => ({ id })) };
    expect(await fetchModels("https://opencode.ai/zen/v1", "k", fakeFetch(200, data))).toEqual(["deepseek-v4-pro", "glm-5.3"]);
    expect(await fetchModels("https://gw.example/v1", "k", fakeFetch(200, data))).toHaveLength(7);
  });
  it("turns a 401 into a Bahasa message", async () => {
    await expect(fetchModels("https://opencode.ai/zen/v1", "bad", fakeFetch(401, {}))).rejects.toThrow("Kunci ditolak");
  });
});
