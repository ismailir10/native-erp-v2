import { z } from "zod";
import type { Db } from "@/lib/db";
import { createFirm } from "@/lib/setup";

export const normalizeEmail = (value: string) => z.email().parse(value.trim().toLowerCase());

/** CLI-only provisioning. A named firm is mandatory; existing users cannot move firms implicitly. */
export async function inviteUser(db: Db, input: { email: string; name: string; firmId: string }) {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  if (!name || !input.firmId) throw new Error("Nama dan ID kantor wajib diisi.");
  return db.$transaction(async (tx) => {
    if (!await tx.firm.findUnique({ where: { id: input.firmId } })) throw new Error("Kantor tidak ditemukan. Periksa ID kantor.");
    const existing = await tx.authUser.findUnique({ where: { email } });
    if (existing && existing.firmId !== input.firmId) throw new Error("Alamat ini sudah terhubung ke kantor lain. Akses tidak diubah.");
    // Re-invitation starts fresh; old sessions and OTPs cannot return after revocation.
    if (existing) {
      await tx.authSession.deleteMany({ where: { userId: existing.id } });
      await tx.authVerification.deleteMany({ where: { identifier: { endsWith: `-${email}` } } });
    }
    return tx.authUser.upsert({ where: { email }, create: { email, name, firmId: input.firmId }, update: { name, disabled: false } });
  });
}

export async function revokeUser(db: Db, input: { email: string; firmId: string }) {
  const email = normalizeEmail(input.email);
  return db.$transaction(async (tx) => {
    const user = await tx.authUser.findUnique({ where: { email } });
    if (!user || user.firmId !== input.firmId) throw new Error("Pengguna tidak ditemukan di kantor ini. Akses tidak diubah.");
    await tx.authUser.update({ where: { id: user.id }, data: { disabled: true } });
    await tx.authSession.deleteMany({ where: { userId: user.id } });
    await tx.authVerification.deleteMany({ where: { identifier: { endsWith: `-${email}` } } });
    return user;
  });
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
