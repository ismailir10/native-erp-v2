"use server";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentFirm } from "@/lib/tenant";
import { requireEvidenceEnabled } from "@/lib/evidence/config";
import { DriveError, oauthAuthorizationUrl, revokeToken } from "@/lib/evidence/drive";
import { adminPasscodeConfigured, decryptSecret, passcodeMatches, settingsSecretConfigured } from "@/lib/settings/secret";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const COOKIE = "buku_drive_oauth";

async function guard(passcode: string): Promise<string | null> {
  requireEvidenceEnabled();
  if (!adminPasscodeConfigured()) return "ADMIN_PASSCODE belum diatur. Hubungi admin untuk mengaktifkan koneksi Google.";
  if (typeof passcode !== "string" || !passcodeMatches(passcode)) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return "Kode admin salah.";
  }
  return null;
}

/** Admin approval is carried to the callback through a browser-bound, single-use state. */
export async function startGoogleAction(passcode: string): Promise<Result<{ url: string }>> {
  try {
    const denied = await guard(passcode);
    if (denied) return { ok: false, error: denied };
    if (!settingsSecretConfigured()) return { ok: false, error: "SETTINGS_SECRET belum diatur. Koneksi Google belum dapat disimpan." };
    const state = randomBytes(32).toString("base64url");
    const browser = randomBytes(32).toString("base64url");
    const url = oauthAuthorizationUrl(state);
    const callback = new URL(process.env.GOOGLE_REDIRECT_URI!);
    const firm = await getCurrentFirm();
    const cookieStore = await cookies();
    const previousBrowser = cookieStore.get(COOKIE)?.value;
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.driveOAuthState.deleteMany({ where: { firmId: firm.id, OR: [
        { expiresAt: { lte: now } },
        ...(previousBrowser ? [{ browserHash: createHash("sha256").update(previousBrowser).digest("hex") }] : []),
      ] } });
      await tx.driveOAuthState.create({ data: {
        id: createHash("sha256").update(state).digest("hex"),
        firmId: firm.id,
        browserHash: createHash("sha256").update(browser).digest("hex"),
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      } });
    });
    cookieStore.set(COOKIE, browser, { httpOnly: true, sameSite: "lax", secure: callback.protocol === "https:", path: "/", maxAge: 600 });
    return { ok: true, url };
  } catch (error) {
    return { ok: false, error: error instanceof DriveError ? error.message : "Koneksi Google belum dapat dimulai. Periksa pengaturan lalu coba kembali." };
  }
}

/** Delete local credentials first so a failed remote revoke never keeps the connection active. */
export async function disconnectGoogleAction(passcode: string): Promise<Result<{ note?: string }>> {
  try {
    const denied = await guard(passcode);
    if (denied) return { ok: false, error: denied };
    const firm = await getCurrentFirm();
    const connection = await prisma.$transaction(async (tx) => {
      const existing = await tx.driveConnection.findUnique({ where: { firmId: firm.id } });
      await tx.driveOAuthState.deleteMany({ where: { firmId: firm.id } });
      await tx.driveConnection.deleteMany({ where: { firmId: firm.id } });
      return existing;
    });
    (await cookies()).delete(COOKIE);
    let note: string | undefined;
    if (connection) {
      try { await revokeToken(decryptSecret(connection.refreshToken)); }
      catch { note = "Koneksi di Buku sudah dihapus. Pencabutan izin Google belum terkonfirmasi; periksa akses Buku di pengaturan akun Google."; }
    }
    revalidatePath("/documents");
    revalidatePath("/settings");
    return { ok: true, ...(note ? { note } : {}) };
  } catch {
    return { ok: false, error: "Koneksi Google belum dapat dihapus. Coba kembali." };
  }
}
