"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { adminPasscodeConfigured, passcodeMatches, settingsSecretConfigured } from "@/lib/settings/secret";
import { clearAiKey, fetchModels, resolveAiConfig, saveAiSettings, SettingsError, validateAiInput } from "@/lib/settings/ai";

/**
 * Pengaturan → AI. Every action needs ADMIN_PASSCODE: the app has no login yet and the demo URL is public.
 * The stored key never leaves the server. Results only carry the last 4 characters.
 */
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function guard(passcode: string): Promise<string | null> {
  if (!adminPasscodeConfigured()) return "ADMIN_PASSCODE belum diatur di server, jadi pengaturan tidak bisa diubah.";
  if (!passcodeMatches(passcode)) {
    await new Promise((r) => setTimeout(r, 1000)); // slows down guessing
    return "Kode admin salah.";
  }
  return null;
}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof SettingsError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Terjadi kesalahan tak terduga. Coba lagi." };
}

export async function saveAiSettingsAction(input: { passcode: string; apiKey: string; model: string }): Promise<Result<{ keyLast4: string | null }>> {
  try {
    const denied = await guard(input.passcode);
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

export async function clearAiKeyAction(input: { passcode: string }): Promise<Result> {
  try {
    const denied = await guard(input.passcode);
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
    const cfg = await resolveAiConfig(prisma);
    return { ok: true, models: await fetchModels(cfg.baseUrl, cfg.apiKey) };
  } catch (e) {
    return fail(e);
  }
}
