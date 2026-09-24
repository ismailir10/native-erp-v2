import type { Db, Tx } from "@/lib/db";
import { aiConfig, chatIncompatibility, OpenAiCompatibleProvider, type AiProvider } from "@/lib/ai/provider";
import { decryptSecret, encryptSecret } from "@/lib/settings/secret";

/**
 * AI key + model set in Pengaturan. Resolution: DB setting → env (AI_API_KEY / AI_MODEL) → rules-only.
 * The base URL is env-only on purpose: if visitors could change it, they could send the stored key to their own server.
 */
export const AI_KEY = "ai.apiKey";
export const AI_MODEL = "ai.model";

export type AiSource = "pengaturan" | "env" | null;
export type ResolvedAiConfig = ReturnType<typeof aiConfig> & {
  keySource: AiSource;
  modelSource: AiSource;
  keyLast4: string | null;
  /** Set when a stored key can't be decrypted (e.g. SETTINGS_SECRET changed). */
  keyError: string | null;
};

type Reader = Pick<Db, "appSetting"> | Pick<Tx, "appSetting">;

export async function resolveAiConfig(db: Reader): Promise<ResolvedAiConfig> {
  const env = aiConfig();
  const rows = await db.appSetting.findMany({ where: { key: { in: [AI_KEY, AI_MODEL] } } });
  const stored = new Map(rows.map((r) => [r.key, r.value]));

  let dbKey: string | null = null;
  let keyError: string | null = null;
  const enc = stored.get(AI_KEY);
  if (enc) {
    try {
      dbKey = decryptSecret(enc);
    } catch {
      keyError = "Kunci AI tersimpan tidak bisa dibuka. SETTINGS_SECRET mungkin berubah. Simpan ulang kuncinya.";
    }
  }
  const dbModel = stored.get(AI_MODEL) || null;
  const apiKey = dbKey ?? env.apiKey;
  const model = dbModel ?? env.model;
  return {
    ...env,
    apiKey,
    model,
    keySource: dbKey ? "pengaturan" : env.apiKey ? "env" : null,
    modelSource: dbModel ? "pengaturan" : env.model ? "env" : null,
    keyLast4: apiKey ? apiKey.slice(-4) : null,
    keyError,
  };
}

export async function saveAiSettings(db: Db, input: { apiKey?: string; model?: string }) {
  const ops = [];
  if (input.apiKey !== undefined) {
    const value = encryptSecret(input.apiKey);
    ops.push(db.appSetting.upsert({ where: { key: AI_KEY }, create: { key: AI_KEY, value }, update: { value } }));
  }
  if (input.model !== undefined) {
    ops.push(db.appSetting.upsert({ where: { key: AI_MODEL }, create: { key: AI_MODEL, value: input.model }, update: { value: input.model } }));
  }
  await db.$transaction(ops);
}

export async function clearAiKey(db: Db) {
  await db.appSetting.deleteMany({ where: { key: AI_KEY } });
}

/** The provider imports use: null (rules-only) unless both a key and a model are configured. */
export async function resolveProvider(db: Reader): Promise<AiProvider | null> {
  const cfg = await resolveAiConfig(db);
  return cfg.apiKey && cfg.model ? new OpenAiCompatibleProvider(cfg) : null;
}

/** GET {baseUrl}/models — lists model ids Buku can call (see `chatIncompatibility`), costs no tokens. Errors are Bahasa, shown verbatim. */
export async function fetchModels(baseUrl: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  let res: Response;
  try {
    const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
    res = await fetchImpl(`${baseUrl}/models`, { headers, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new SettingsError(`Tidak bisa menghubungi ${new URL(baseUrl).host}. Coba lagi sebentar.`);
  }
  if (res.status === 401 || res.status === 403) throw new SettingsError("Kunci ditolak oleh gateway. Periksa kuncinya.");
  if (!res.ok) throw new SettingsError(`Gateway membalas ${res.status}. Coba lagi sebentar.`);
  const body = (await res.json().catch(() => ({}))) as { data?: { id?: unknown }[] };
  return (body.data ?? [])
    .map((m) => String(m.id ?? ""))
    .filter((id) => id && !chatIncompatibility(baseUrl, id))
    .sort();
}

export class SettingsError extends Error {}

const KEY_RE = /^\S{8,300}$/;
const MODEL_RE = /^[\w.:/-]{1,100}$/;

/** Validates input for Pengaturan → AI. Returns the fields to write (key only when a new one was typed). */
export function validateAiInput(input: { apiKey: string; model: string }, baseUrl = aiConfig().baseUrl) {
  const apiKey = input.apiKey.trim();
  const model = input.model.trim();
  if (apiKey && !KEY_RE.test(apiKey)) throw new SettingsError("Kunci API tidak valid. Tempel kunci lengkap tanpa spasi.");
  if (!MODEL_RE.test(model)) throw new SettingsError("Isi nama model. Klik Muat daftar model untuk memilih.");
  const incompatible = chatIncompatibility(baseUrl, model);
  if (incompatible) throw new SettingsError(incompatible);
  return { apiKey: apiKey || undefined, model };
}
