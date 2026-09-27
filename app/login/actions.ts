"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getWorkspaceSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { appUrl } from "@/lib/supabase/env";

export type FormState = { error?: string; notice?: string };

const credentials = z.object({ email: z.email(), password: z.string().min(1) });

function loginError(error: { code?: string; status?: number }) {
  if (error.status === 429 || error.code === "over_request_rate_limit") return "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.";
  if (error.code === "user_banned") return "Akses tidak tersedia. Hubungi pengelola Buku.";
  if (error.code === "invalid_credentials" || error.status === 400) return "Email atau kata sandi tidak cocok.";
  return "Masuk gagal. Periksa koneksi lalu coba lagi.";
}

export async function signInAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const parsed = credentials.safeParse({ email: String(formData.get("email") ?? "").trim().toLowerCase(), password: formData.get("password") });
  if (!parsed.success) return { error: "Isi email yang valid dan kata sandi." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: loginError(error) };
  // The password proved identity; membership decides access. A revoked member is signed out again at once.
  if (!await getWorkspaceSession()) {
    await supabase.auth.signOut();
    return { error: "Akses tidak tersedia. Hubungi pengelola Buku." };
  }
  redirect("/");
}

/** Public origin for the link in the email: APP_URL when set, else the request's own origin. */
async function callbackUrl() {
  const base = appUrl();
  if (base) return `${base}/auth/callback`;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/auth/callback`;
}

export async function requestResetAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const email = z.email().safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!email.success) return { error: "Isi email yang valid." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, { redirectTo: await callbackUrl() });
  if (error && (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit")) return { error: "Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi." };
  // Never reveals whether the address is a member.
  return { notice: "Jika alamat ini terdaftar, tautan atur ulang kata sandi masuk ke email. Periksa juga folder spam." };
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
