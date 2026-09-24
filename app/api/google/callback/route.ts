import { createHash } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentFirm } from "@/lib/tenant";
import { requireEvidenceEnabled } from "@/lib/evidence/config";
import { exchangeCode, oauthConfigured } from "@/lib/evidence/drive";
import { encryptSecret, settingsSecretConfigured } from "@/lib/settings/secret";

export const runtime = "nodejs";
const COOKIE = "buku_drive_oauth";

function finish(connected: boolean) {
  // Relative, fixed destination avoids forwarding OAuth parameters or trusting the Host header.
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: `/documents?google=${connected ? "connected" : "error"}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
  response.cookies.set(COOKIE, "", { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.GOOGLE_REDIRECT_URI?.startsWith("https:") ?? false, maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  try {
    requireEvidenceEnabled();
    if (!oauthConfigured() || !settingsSecretConfigured()) return finish(false);
    const state = request.nextUrl.searchParams.get("state");
    const browser = request.cookies.get(COOKIE)?.value;
    if (!state || !browser || !/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(browser)) return finish(false);
    const firm = await getCurrentFirm();
    const binding = {
      id: createHash("sha256").update(state).digest("hex"),
      firmId: firm.id,
      browserHash: createHash("sha256").update(browser).digest("hex"),
    };
    // Keep approval cancellable while Google exchanges the code. Disconnect deletes it.
    if (!await prisma.driveOAuthState.findFirst({ where: { ...binding, expiresAt: { gt: new Date() } } })) return finish(false);
    if (request.nextUrl.searchParams.has("error")) {
      await prisma.driveOAuthState.deleteMany({ where: binding });
      return finish(false);
    }
    const code = request.nextUrl.searchParams.get("code");
    if (!code || code.length > 4096) return finish(false);
    const token = await exchangeCode(code);
    // Never keep a previous account's refresh token when consent supplied no new token.
    if (!token.refreshToken) return finish(false);
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
    return finish(connected);
  } catch {
    // Provider errors, authorization codes and tokens never enter URLs or logs.
    return finish(false);
  }
}
