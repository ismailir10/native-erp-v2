import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "./env";

/** Refreshes the session cookie on every request so Server Components always read a live token. */
export async function updateSession(request: NextRequest) {
  const env = supabaseEnv();
  let response = NextResponse.next({ request });
  if (!env) return response;
  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list, headers) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });
  // Nothing may run between the client creation and this call (Supabase guidance): it performs the refresh.
  await supabase.auth.getClaims();
  return response;
}
