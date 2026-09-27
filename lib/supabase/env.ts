/** Supabase connection settings. Accepts both the new (publishable/secret) and the Vercel-integration (anon/service_role) names. */
export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

export function supabaseSecretKey() {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

/** Public origin of this deployment, used for invite / reset links. Empty = the project's Site URL. */
export function appUrl() {
  return (process.env.APP_URL ?? "").replace(/\/$/, "");
}
