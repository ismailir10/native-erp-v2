"use server";

import { revalidatePath } from "next/cache";
import { getCurrentFirm } from "@/lib/tenant";
import { requireMember } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { settingsSecretConfigured } from "@/lib/settings/secret";
import { clearAiKey, fetchModels, resolveAiConfig, saveAiSettings, SettingsError, validateAiInput } from "@/lib/settings/ai";

/**
 * Pengaturan → AI. Every action requires a workspace session; credential changes need the ADMIN role.
 * The stored key never leaves the server. Results only carry the last 4 characters.
 */
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Admin-only; the message is the one the form shows verbatim. */
async function guard(): Promise<string | null> {
  try { await requireMember("ADMIN"); return null; }
  catch (e) { return e instanceof Error ? e.message : "Masuk terlebih dahulu."; }
}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof SettingsError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Terjadi kesalahan tak terduga. Coba lagi." };
}

export async function saveAiSettingsAction(input: { apiKey: string; model: string }): Promise<Result<{ keyLast4: string | null }>> {
  try {
    const denied = await guard();
    if (denied) return { ok: false, error: denied };
    if (!settingsSecretConfigured()) return { ok: false, error: "SETTINGS_SECRET belum diatur di server, jadi kunci tidak bisa disimpan." };
    const fields = validateAiInput(input);
    await saveAiSettings(prisma, fields);
    revalidatePath("/", "layout");
    return { ok: true, keyLast4: (await resolveAiConfig(prisma)).keyLast4 };
  } catch (e) {
    return fail(e);
  }
}

export async function clearAiKeyAction(): Promise<Result> {
  try {
    const denied = await guard();
    if (denied) return { ok: false, error: denied };
    await clearAiKey(prisma);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Model ids from GET {baseUrl}/models (no tokens). OpenCode Zen serves this list without checking the key. */
export async function listModelsAction(): Promise<Result<{ models: string[] }>> {
  try {
    await getCurrentFirm();
    const cfg = await resolveAiConfig(prisma);
    return { ok: true, models: await fetchModels(cfg.baseUrl, cfg.apiKey) };
  } catch (e) {
    return fail(e);
  }
}
