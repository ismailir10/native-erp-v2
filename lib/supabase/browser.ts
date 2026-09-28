import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser client for the password-setting page only. `@supabase/ssr` forces the PKCE flow, so the tokens
 * an invite / recovery link puts in the URL fragment are adopted explicitly with `setSession` (see
 * app/atur-sandi); PKCE `?code=` links are exchanged server-side in /auth/callback before the page loads.
 */
export function createSupabaseBrowserClient(url: string, publishableKey: string) {
  return createBrowserClient(url, publishableKey);
}

/** Tokens from a Supabase implicit-flow redirect, or the error it reports there. */
export function readAuthFragment(hash: string): { error: "expired" | "invalid" } | { accessToken: string; refreshToken: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (params.get("error")) return { error: params.get("error_code") === "otp_expired" ? "expired" : "invalid" };
  if (accessToken && refreshToken) return { accessToken, refreshToken };
  return null;
}
