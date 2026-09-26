import { createHash } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentFirm } from "@/lib/tenant";
import { requireEvidenceEnabled } from "@/lib/evidence/config";
import { DriveError, exchangeCode, oauthConfigured } from "@/lib/evidence/drive";
import { encryptSecret, settingsSecretConfigured } from "@/lib/settings/secret";

export const runtime = "nodejs";
const COOKIE = "buku_drive_oauth";

/** Allowlisted failure reasons: the only callback detail that reaches a URL or a log line. */
export type GoogleFailure = "config" | "state" | "denied" | "exchange" | "no_refresh_token" | "scope" | "invalid_client";

function finish(connected: boolean, reason?: GoogleFailure) {
  if (!connected) console.warn(`google oauth callback failed: ${reason ?? "state"}`);
  // Relative, fixed destination avoids forwarding OAuth parameters or trusting the Host header.
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: connected ? "/documents?google=connected" : `/documents?google=error&reason=${reason ?? "state"}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
  response.cookies.set(COOKIE, "", { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.GOOGLE_REDIRECT_URI?.startsWith("https:") ?? false, maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  try {
    requireEvidenceEnabled();
    if (!oauthConfigured() || !settingsSecretConfigured()) return finish(false, "config");
    const state = request.nextUrl.searchParams.get("state");
    const browser = request.cookies.get(COOKIE)?.value;
    if (!state || !browser || !/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(browser)) return finish(false, "state");
    const firm = await getCurrentFirm();
    const binding = {
      id: createHash("sha256").update(state).digest("hex"),
      firmId: firm.id,
      browserHash: createHash("sha256").update(browser).digest("hex"),
    };
    // Keep approval cancellable while Google exchanges the code. Disconnect deletes it.
    if (!await prisma.driveOAuthState.findFirst({ where: { ...binding, expiresAt: { gt: new Date() } } })) return finish(false, "state");
    if (request.nextUrl.searchParams.has("error")) {
      await prisma.driveOAuthState.deleteMany({ where: binding });
      return finish(false, "denied");
    }
    const code = request.nextUrl.searchParams.get("code");
    if (!code || code.length > 4096) return finish(false, "exchange");
    const token = await exchangeCode(code);
    // Never keep a previous account's refresh token when consent supplied no new token.
    if (!token.refreshToken) return finish(false, "no_refresh_token");
    const encrypted = encryptSecret(token.refreshToken);
    const connected = await prisma.$transaction(async tx => {
      // Both writes commit together: replay, expiry, reconnect or disconnect cancels this callback.
      const consumed = await tx.driveOAuthState.deleteMany({ where: { ...binding, expiresAt: { gt: new Date() } } });
      if (consumed.count !== 1) return false;
      await tx.driveConnection.upsert({
        where: { firmId: firm.id },
        create: { firmId: firm.id, refreshToken: encrypted },
        update: { refreshToken: encrypted },
      });
      return true;
    });
    return connected ? finish(true) : finish(false, "state");
  } catch (error) {
    // Provider errors, authorization codes and tokens never enter URLs or logs — only the reason.
    const code = error instanceof DriveError ? error.code : "";
    return finish(false, code === "SCOPE" ? "scope" : code === "CONFIG" ? "invalid_client" : code === "NOT_CONFIGURED" ? "config" : "exchange");
  }
}
