import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Landing point of every email link (invite, password reset). Three shapes arrive here:
 * `?code=` (PKCE, from a reset requested in this browser), `?token_hash=&type=` (custom templates),
 * or tokens in the URL fragment (Supabase's default template) — the fragment survives the redirect and
 * is consumed by the browser on /atur-sandi. Secrets never stay in the address bar.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const target = request.nextUrl.clone();
  target.pathname = "/atur-sandi";
  target.search = "";
  if (params.get("error")) {
    target.searchParams.set("error", params.get("error_code") === "otp_expired" ? "expired" : "invalid");
    return NextResponse.redirect(target);
  }
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  if (code || (tokenHash && type)) {
    const supabase = await createSupabaseServerClient();
    const { error } = code ? await supabase.auth.exchangeCodeForSession(code) : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: type! });
    if (error) target.searchParams.set("error", error.code === "otp_expired" ? "expired" : "invalid");
  }
  return NextResponse.redirect(target);
}
