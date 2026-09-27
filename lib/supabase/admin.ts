import { createClient } from "@supabase/supabase-js";
import { supabaseEnv, supabaseSecretKey } from "./env";

/** Service-role client for invitations and revocation. Server / CLI only; never reaches a browser bundle. */
export function createSupabaseAdmin() {
  const env = supabaseEnv();
  const secret = supabaseSecretKey();
  if (!env || !secret) throw new Error("SUPABASE_SECRET_KEY belum diatur. Undangan hanya bisa dikirim dari server yang memilikinya.");
  return createClient(env.url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
}
export type SupabaseAdmin = ReturnType<typeof createSupabaseAdmin>;
