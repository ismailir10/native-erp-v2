import type { Db } from "@/lib/db";
import { resolvePlatformAdmin } from "@/lib/auth/platform";

/**
 * Support sessions (ADR 0017 §2): a Buku admin's quiet, read-only look into an organisation's workspace as one of its members, for
 * troubleshooting. At most 60 minutes (a database CHECK), started with a reason, needs the admin's two-step login (aal2), recorded on
 * Buku's side only (SupportSession, SupportSessionView, PlatformAuditEvent). The tenant sees nothing; every write is refused.
 */
export const SUPPORT_COOKIE = "buku_support";
export const SUPPORT_MINUTES = 60;
export const SUPPORT_READ_ONLY = "Mode dukungan hanya baca. Perubahan dilakukan oleh organisasi sendiri.";
export const NEEDS_MFA = "Aktifkan verifikasi dua langkah dulu untuk membuka ruang kerja organisasi.";

export class SupportError extends Error {}

export async function startSupportSession(db: Db, input: { adminId: string; aal: string; firmId: string; asMemberId: string; reason: string }, now = new Date()) {
  if (input.aal !== "aal2") throw new SupportError(NEEDS_MFA);
  const reason = input.reason.trim();
  if (reason.length < 10) throw new SupportError("Tulis alasan membuka ruang kerja (min. 10 karakter).");
  const member = await db.firmMember.findFirst({ where: { id: input.asMemberId, firmId: input.firmId }, select: { id: true, name: true } });
  if (!member) throw new SupportError("Anggota tidak ditemukan di organisasi ini.");
  return db.$transaction(async (tx) => {
    // One live session per admin: starting another ends the previous one.
    await tx.supportSession.updateMany({ where: { adminId: input.adminId, endedAt: null }, data: { endedAt: now } });
    const session = await tx.supportSession.create({ data: { adminId: input.adminId, firmId: input.firmId, asMemberId: member.id, reason, startedAt: now, expiresAt: new Date(now.getTime() + SUPPORT_MINUTES * 60_000) } });
    await tx.platformAuditEvent.create({ data: { adminId: input.adminId, firmId: input.firmId, kind: "SUPPORT_START", summary: `Ruang kerja dibuka sebagai ${member.name} · ${reason}` } });
    return session;
  });
}

export async function endSupportSession(db: Db, adminId: string, sessionId: string, now = new Date()) {
  const session = await db.supportSession.findFirst({ where: { id: sessionId, adminId } });
  if (!session || session.endedAt) return session;
  await db.$transaction([
    db.supportSession.update({ where: { id: session.id }, data: { endedAt: now < session.expiresAt ? now : session.expiresAt } }),
    db.platformAuditEvent.create({ data: { adminId, firmId: session.firmId, kind: "SUPPORT_END", summary: "Mode dukungan diakhiri" } }),
  ]);
  return session;
}

/**
 * The live support session behind a cookie, for the signed-in user: the user is an active Buku admin with aal2, the session is
 * theirs, not ended and not past its 60 minutes. Anything else resolves to nothing (the user is then just themselves).
 */
export async function resolveSupportSession(db: Db, userId: string, aal: string, sessionId: string, now = new Date()) {
  if (aal !== "aal2") return null;
  const admin = await resolvePlatformAdmin(db, userId);
  if (!admin) return null;
  const session = await db.supportSession.findFirst({ where: { id: sessionId, adminId: admin.id, endedAt: null, expiresAt: { gt: now } }, include: { firm: { select: { name: true } } } });
  return session && { session, admin };
}

/** Each page and download of a support session, append-only (a failure never blocks the page). */
export async function logSupportView(db: Db, sessionId: string, path: string, kind: "VIEW" | "EXPORT" = "VIEW") {
  try { await db.supportSessionView.create({ data: { sessionId, path: path.slice(0, 500), kind } }); }
  catch (e) { console.error("support view log", e instanceof Error ? e.message : e); }
}
