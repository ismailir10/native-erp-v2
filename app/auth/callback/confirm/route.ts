import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { appUrl } from "@/lib/supabase/env";
import { readLinkToken } from "../token";

/** Public authentication boundary: no workspace exists yet. A same-origin form POST proves user intent; Auth verifies the secret. */
export async function POST(request: NextRequest) {
  const origin = new URL(appUrl() || request.url).origin;
  const finish = (path: string) => {
    const response = NextResponse.redirect(new URL(path, origin), 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  };
  const sentOrigin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  // The page's no-referrer policy makes browsers send Origin: null on a form POST.
  // Fetch Metadata still proves same-origin navigation; cross-site/same-site requests cannot set this browser-owned header.
  const sameOrigin = sentOrigin === origin || (sentOrigin === "null" && site === "same-origin");
  if (!sameOrigin || site === "cross-site" || site === "same-site") {
    return new NextResponse("Permintaan tidak berlaku. Buka kembali tautan dari email Anda.", { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const form = await request.formData().catch(() => null);
  if (!form || ["code", "token_hash", "type"].some((key) => form.getAll(key).length > 1)) return finish("/auth/callback?error=invalid");
  const token = readLinkToken({ code: form.get("code"), token_hash: form.get("token_hash"), type: form.get("type") });
  if (!token) return finish("/auth/callback?error=invalid");
  try {
    const auth = (await createSupabaseServerClient()).auth;
    const { error } = "code" in token ? await auth.exchangeCodeForSession(token.code) : await auth.verifyOtp({ token_hash: token.tokenHash, type: token.type });
    if (error) {
      // No token, URL, email or raw provider response enters logs or the rendered error page.
      console.warn("auth link verification refused", { code: error.code, status: error.status });
      return finish("/auth/callback?error=expired");
    }
    return finish("code" in token || token.type === "invite" || token.type === "recovery" ? "/atur-sandi" : "/login");
  } catch {
    console.error("auth link verification unavailable");
    return finish("/auth/callback?error=invalid");
  }
}
