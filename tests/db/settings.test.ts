import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "../helpers";
import { decryptSecret, encryptSecret, passcodeMatches } from "@/lib/settings/secret";
import { AI_KEY, clearAiKey, resolveAiConfig, saveAiSettings } from "@/lib/settings/ai";
import { truncateAll } from "@/lib/demo/seed";

const SECRET = "test-secret-0123456789abcdefghijklmnop";

describe("settings secret", () => {
  beforeEach(() => vi.stubEnv("SETTINGS_SECRET", SECRET));
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips and never stores plaintext", () => {
    const enc = encryptSecret("sk-zen-abc123");
    expect(enc).not.toContain("sk-zen");
    expect(decryptSecret(enc)).toBe("sk-zen-abc123");
    expect(encryptSecret("sk-zen-abc123")).not.toBe(enc); // random IV
  });

  it("rejects tampering and a different SETTINGS_SECRET", () => {
    const enc = encryptSecret("sk-zen-abc123");
    const buf = Buffer.from(enc.slice(3), "base64");
    buf[buf.length - 1] ^= 1;
    expect(() => decryptSecret("v1:" + buf.toString("base64"))).toThrow();
    vi.stubEnv("SETTINGS_SECRET", SECRET.replace("test", "prod"));
    expect(() => decryptSecret(enc)).toThrow();
  });

  it("refuses a short or missing SETTINGS_SECRET", () => {
    vi.stubEnv("SETTINGS_SECRET", "short");
    expect(() => encryptSecret("x")).toThrow(/SETTINGS_SECRET/);
  });

  it("checks the passcode, and nothing matches when ADMIN_PASSCODE is unset", () => {
    vi.stubEnv("ADMIN_PASSCODE", "kopi-tubruk-42");
    expect(passcodeMatches("kopi-tubruk-42")).toBe(true);
    expect(passcodeMatches("kopi-tubruk-4")).toBe(false);
    vi.stubEnv("ADMIN_PASSCODE", "");
    expect(passcodeMatches("")).toBe(false);
  });
});

describe("AI settings resolution", () => {
  beforeEach(async () => {
    vi.stubEnv("SETTINGS_SECRET", SECRET);
    await resetDb();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("falls back from Pengaturan to env to rules-only", async () => {
    let cfg = await resolveAiConfig(db);
    expect(cfg).toMatchObject({ apiKey: "", model: "", keySource: null, keyLast4: null });

    vi.stubEnv("AI_API_KEY", "env-key-9999");
    vi.stubEnv("AI_MODEL", "env-model");
    cfg = await resolveAiConfig(db);
    expect(cfg).toMatchObject({ apiKey: "env-key-9999", model: "env-model", keySource: "env", modelSource: "env", keyLast4: "9999" });

    await saveAiSettings(db, { apiKey: "db-key-1234", model: "db-model" });
    cfg = await resolveAiConfig(db);
    expect(cfg).toMatchObject({ apiKey: "db-key-1234", model: "db-model", keySource: "pengaturan", modelSource: "pengaturan", keyLast4: "1234" });
    const row = await db.appSetting.findUnique({ where: { key: AI_KEY } });
    expect(row!.value).not.toContain("db-key");

    await clearAiKey(db);
    cfg = await resolveAiConfig(db);
    expect(cfg).toMatchObject({ apiKey: "env-key-9999", keySource: "env", model: "db-model" });
  });

  it("reports an undecryptable key instead of using it", async () => {
    await saveAiSettings(db, { apiKey: "db-key-1234" });
    vi.stubEnv("SETTINGS_SECRET", SECRET + "-rotated");
    const cfg = await resolveAiConfig(db);
    expect(cfg.apiKey).toBe("");
    expect(cfg.keyError).toMatch(/Simpan ulang/);
  });

  it("survives the demo reset", async () => {
    await saveAiSettings(db, { apiKey: "db-key-1234", model: "db-model" });
    await truncateAll(db);
    expect((await resolveAiConfig(db)).apiKey).toBe("db-key-1234");
  });
});
