import { createBrowserClient } from "@supabase/ssr";

/** Browser client for the password-setting page: consumes the tokens of an invite / recovery link. */
export function createSupabaseBrowserClient(url: string, publishableKey: string) {
  return createBrowserClient(url, publishableKey);
}
