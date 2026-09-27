import { supabaseEnv } from "@/lib/supabase/env";

/** Login is available only when the deployment knows its Supabase project. Missing = workspace stays closed. */
export function authConfigured() {
  return supabaseEnv() !== null;
}
