import { z } from "zod";
import type { Db } from "@/lib/db";
import type { MemberRole } from "@/lib/generated/prisma/enums";
import { createFirm } from "@/lib/setup";
import type { SupabaseAdmin } from "@/lib/supabase/admin";

export const normalizeEmail = (value: string) => z.email().parse(value.trim().toLowerCase());
const BAN_FOREVER = "876600h";

/** The slice of the Supabase Auth API these operations need (`supabase.auth` of a service-role client); tests pass a fake. */
export type AuthApi = {
  admin: Pick<SupabaseAdmin["auth"]["admin"], "inviteUserByEmail" | "updateUserById" | "createUser"> & { listUsers?: SupabaseAdmin["auth"]["admin"]["listUsers"]; deleteUser?: SupabaseAdmin["auth"]["admin"]["deleteUser"] };
  /** Public endpoint: Supabase sends the recovery email itself. */
  resetPasswordForEmail: SupabaseAdmin["auth"]["resetPasswordForEmail"];
};

function fail(error: { message: string } | null, fallback: string): never {
  throw new Error(error?.message ? `${fallback} (${error.message})` : fallback);
}

const PAGE = 1000;

/** Every Auth page is searched: a large project's orphan may sit past the first page. */
async function findAuthUser(auth: AuthApi, email: string) {
  if (!auth.admin.listUsers) return undefined;
  for (let page = 1; ; page++) {
    const { data, error } = await auth.admin.listUsers({ page, perPage: PAGE });
    if (error) fail(error, "Daftar pengguna Supabase tidak bisa dibaca.");
    const users = data?.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === email);
    if (found || users.length < PAGE) return found;
  }
}

/**
 * CLI-only provisioning. Creates the Supabase user (invite email) and the firm member together.
 * A re-invitation of a revoked member lifts the ban and sends a fresh password link.
 */
export async function inviteUser(db: Db, auth: AuthApi, input: { email: string; name: string; firmId: string; role?: MemberRole; redirectTo?: string }) {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  const role: MemberRole = input.role ?? "AKUNTAN";
  if (!name || !input.firmId) throw new Error("Nama dan ID kantor wajib diisi.");
  if (!await db.firm.findUnique({ where: { id: input.firmId } })) throw new Error("Kantor tidak ditemukan. Periksa ID kantor.");
  const existing = await db.firmMember.findUnique({ where: { email } });
  if (existing && existing.firmId !== input.firmId) throw new Error("Alamat ini sudah terhubung ke kantor lain. Akses tidak diubah.");
  const redirect = input.redirectTo ? { redirectTo: `${input.redirectTo.replace(/\/$/, "")}/auth/callback` } : {};

  if (existing) {
    const unbanned = await auth.admin.updateUserById(existing.userId, { ban_duration: "none" });
    if (unbanned.error) fail(unbanned.error, "Akses lama tidak bisa dipulihkan.");
    // Sends the recovery email (a generated link would only be returned, never delivered).
    const sent = await auth.resetPasswordForEmail(email, redirect);
    if (sent.error) fail(sent.error, "Tautan kata sandi belum terkirim.");
    return db.firmMember.update({ where: { id: existing.id }, data: { name, role, disabled: false } });
  }
  const invited = await auth.admin.inviteUserByEmail(email, { data: { name }, ...redirect });
  let userId = invited.data?.user?.id;
  const fresh = !!userId;
  if (!userId) {
    // The address may already be in Auth without a member (an earlier invitation whose member insert failed): take it over and
    // send a password link, instead of leaving the person impossible to provision.
    const orphan = await findAuthUser(auth, email);
    if (!orphan) fail(invited.error, "Undangan belum terkirim.");
    const unbanned = await auth.admin.updateUserById(orphan.id, { ban_duration: "none" });
    if (unbanned.error) fail(unbanned.error, "Akun yang sudah ada tidak bisa dipulihkan.");
    const sent = await auth.resetPasswordForEmail(email, redirect);
    if (sent.error) fail(sent.error, "Tautan kata sandi belum terkirim.");
    userId = orphan.id;
  }
  try {
    return await db.firmMember.create({ data: { userId, email, name, role, firmId: input.firmId } });
  } catch (e) {
    // Never leave a just-created Auth user without its member; a retry then starts clean. A concurrent invitation may have
    // adopted it in the meantime (its member insert won the race): then the user is theirs and stays.
    if (fresh && !(await db.firmMember.findUnique({ where: { userId } }).catch(() => null))) await auth.admin.deleteUser?.(userId).catch(() => undefined);
    throw e;
  }
}

/** Disabling the member closes the workspace at once (checked on every request); the ban stops new logins. */
export async function revokeUser(db: Db, auth: AuthApi, input: { email: string; firmId: string }) {
  const email = normalizeEmail(input.email);
  const member = await db.firmMember.findUnique({ where: { email } });
  if (!member || member.firmId !== input.firmId) throw new Error("Pengguna tidak ditemukan di kantor ini. Akses tidak diubah.");
  const updated = await db.firmMember.update({ where: { id: member.id }, data: { disabled: true } });
  const banned = await auth.admin.updateUserById(member.userId, { ban_duration: BAN_FOREVER });
  if (banned.error) fail(banned.error, "Akses dicabut di Buku, tetapi sesi Supabase belum ditutup. Ulangi perintah.");
  return updated;
}

export async function listMembers(db: Db) {
  return db.firmMember.findMany({ include: { firm: { select: { name: true } } }, orderBy: [{ firmId: "asc" }, { email: "asc" }] });
}

/** Bootstrap an empty deployment explicitly, never as a side effect of visiting a page. */
export async function initializeWorkspace(db: Db, name: string) {
  if (!name.trim()) throw new Error("Nama kantor wajib diisi.");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(4242)::text`;
    if (await tx.firm.count()) throw new Error("Kantor sudah ada. Gunakan access list untuk memilih ID kantor.");
    return createFirm(tx, name.trim());
  });
}

/**
 * Demo / test admin with a known password (staging, local, e2e only — the seed refuses to run it in DEMO_MODE=false).
 * Idempotent: an existing Supabase user gets its password and membership refreshed.
 */
export async function ensureLocalAdmin(db: Db, auth: AuthApi, input: { email: string; password: string; name: string; firmId: string }) {
  const email = normalizeEmail(input.email);
  if (input.password.length < 8) throw new Error("Kata sandi demo minimal 8 karakter.");
  const created = await auth.admin.createUser({ email, password: input.password, email_confirm: true, user_metadata: { name: input.name } });
  let userId = created.data.user?.id;
  if (!userId) {
    if (!auth.admin.listUsers) fail(created.error, "Akun demo tidak bisa dibuat.");
    const page = await auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = page.data.users.find((user) => user.email?.toLowerCase() === email)?.id;
    if (!userId) fail(created.error, "Akun demo tidak bisa dibuat.");
    const updated = await auth.admin.updateUserById(userId, { password: input.password, email_confirm: true, ban_duration: "none" });
    if (updated.error) fail(updated.error, "Kata sandi akun demo tidak bisa diperbarui.");
  }
  const existing = await db.firmMember.findUnique({ where: { email } });
  if (existing && existing.userId !== userId) await db.firmMember.delete({ where: { id: existing.id } });
  return db.firmMember.upsert({
    where: { email },
    create: { userId, email, name: input.name, role: "ADMIN", firmId: input.firmId },
    update: { userId, name: input.name, role: "ADMIN", disabled: false, firmId: input.firmId },
  });
}
