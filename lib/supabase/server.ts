import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseEnv } from "./env";

/** Per-request client bound to the Next.js cookie store. Never cache it across requests. */
export async function createSupabaseServerClient() {
  const env = supabaseEnv();
  if (!env) throw new Error("Akses Buku belum dikonfigurasi. Hubungi pengelola.");
  const store = await cookies();
  return createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { for (const { name, value, options } of list) store.set(name, value, options); }
        catch { /* Server Components cannot set cookies; proxy.ts refreshes the session instead. */ }
      },
    },
  });
}
