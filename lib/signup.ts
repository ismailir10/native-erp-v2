import type { Db, Tx } from "@/lib/db";
import type { OrgKind } from "@/lib/generated/prisma/enums";
import { createOrganisationTx } from "@/lib/access/admin";
import { inviteUser, normalizeEmail, type AuthApi } from "@/lib/auth/operator";
import { formatDateWib } from "@/lib/format";

/**
 * Trial requests (ADR 0017 §4): the public `/daftar` form creates a SignupRequest; a Buku admin approves it in the backoffice, which
 * creates the organisation, its TRIAL grant and the owner's invitation in one step. Supabase self-signup stays off.
 */
export class SignupError extends Error {}

export const SIGNUP_THANKS = "Terima kasih. Kami kirim email setelah akses uji coba disetujui.";
const WINDOW_MS = 60 * 60_000;
const PER_WINDOW = 5;
const KINDS: OrgKind[] = ["KANTOR_AKUNTAN", "PERUSAHAAN"];

export type SignupInput = { email: string; name: string; orgName: string; orgKind: string; phone?: string; note?: string; website?: string };

const clip = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

/** Fixed one-hour window per key; true while the key is under the limit (the count is taken either way). */
async function allow(tx: Tx, key: string, now: Date) {
  const row = await tx.signupThrottle.findUnique({ where: { key } });
  if (!row || now.getTime() - row.windowStart.getTime() >= WINDOW_MS) {
    await tx.signupThrottle.upsert({ where: { key }, create: { key, windowStart: now, count: 1 }, update: { windowStart: now, count: 1 } });
    return true;
  }
  await tx.signupThrottle.update({ where: { key }, data: { count: { increment: 1 } } });
  return row.count < PER_WINDOW;
}

/**
 * A trial request. Field errors are told (the form can fix them); everything else answers the same thanks, whether the request was
 * stored, throttled, a duplicate or a bot (the hidden `website` field), so the form never says who already asked or has access.
 */
export async function submitSignup(db: Db, input: SignupInput, ip: string | null, now = new Date()): Promise<{ stored: boolean }> {
  let email: string;
  try { email = normalizeEmail(String(input.email ?? "")); } catch { throw new SignupError("Tulis alamat email kerja yang valid."); }
  const name = clip(input.name, 120);
  const orgName = clip(input.orgName, 160);
  if (!name) throw new SignupError("Tulis nama Anda.");
  if (!orgName) throw new SignupError("Tulis nama kantor atau perusahaan.");
  if (!KINDS.includes(input.orgKind as OrgKind)) throw new SignupError("Pilih kantor akuntan atau perusahaan.");
  if (clip(input.website, 200)) return { stored: false };
  return db.$transaction(async (tx) => {
    const byEmail = await allow(tx, `signup:email:${email}`, now);
    const byIp = ip ? await allow(tx, `signup:ip:${ip}`, now) : true;
    if (!byEmail || !byIp) return { stored: false };
    if (await tx.signupRequest.findFirst({ where: { email, status: "PENDING" }, select: { id: true } })) return { stored: false };
    await tx.signupRequest.create({ data: { email, name, orgName, orgKind: input.orgKind as OrgKind, phone: clip(input.phone, 40) || null, note: clip(input.note, 1000) || null, ip: ip?.slice(0, 64) ?? null, createdAt: now } });
    return { stored: true };
  });
}

export async function listSignups(db: Db) {
  return db.signupRequest.findMany({ include: { decidedBy: { select: { name: true } } }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 200 });
}

async function pending(tx: Tx | Db, id: string) {
  const request = await tx.signupRequest.findUnique({ where: { id } });
  if (!request) throw new SignupError("Permintaan tidak ditemukan.");
  if (request.status !== "PENDING") throw new SignupError("Permintaan ini sudah diputuskan.");
  return request;
}

/**
 * Approve: the organisation (a company also gets its books), a TRIAL grant to `endsOn` and the owner's invitation, all or nothing.
 * The invitation is the last step inside the transaction, so a failed invite leaves no organisation and no log entry behind.
 */
export async function approveSignup(db: Db, auth: AuthApi, adminId: string, requestId: string, input: { endsOn: string; redirectTo?: string }, now = new Date()) {
  const request = await pending(db, requestId);
  if (await db.firmMember.findUnique({ where: { email: request.email }, select: { id: true } })) throw new SignupError("Alamat ini sudah menjadi anggota organisasi lain di Buku. Tolak permintaan ini atau hubungi orangnya.");
  return db.$transaction(async (tx) => {
    await pending(tx, requestId);
    const firm = await createOrganisationTx(tx, adminId, { name: request.orgName, kind: request.orgKind, grant: { kind: "TRIAL", endsOn: input.endsOn, note: "Uji coba dari /daftar" } }, now);
    await tx.signupRequest.update({ where: { id: request.id }, data: { status: "APPROVED", firmId: firm.id, decidedById: adminId, decidedAt: now } });
    await tx.platformAuditEvent.create({ data: { adminId, firmId: firm.id, kind: "SIGNUP_APPROVED", summary: `Permintaan ${request.email} disetujui · uji coba s.d. ${firm.endsAt ? formatDateWib(firm.endsAt) : "tanpa batas"}` } });
    const data = { org_name: request.orgName, org_kind: request.orgKind, access_until: firm.endsAt ? formatDateWib(firm.endsAt) : "" };
    await inviteUser(tx as unknown as Db, auth, { email: request.email, name: request.name, firmId: firm.id, role: "OWNER", redirectTo: input.redirectTo, data });
    return firm;
  }, { timeout: 30_000 });
}

export async function rejectSignup(db: Db, adminId: string, requestId: string, reason: string, now = new Date()) {
  if (reason.trim().length < 5) throw new SignupError("Tulis alasan menolak (min. 5 karakter).");
  const request = await pending(db, requestId);
  await db.$transaction([
    db.signupRequest.update({ where: { id: request.id }, data: { status: "REJECTED", reason: reason.trim(), decidedById: adminId, decidedAt: now } }),
    db.platformAuditEvent.create({ data: { adminId, kind: "SIGNUP_REJECTED", summary: `Permintaan ${request.email} (${request.orgName}) ditolak · ${reason.trim()}` } }),
  ]);
}
