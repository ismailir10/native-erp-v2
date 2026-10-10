import type { Db } from "@/lib/db";
import type { MemberRole } from "@/lib/generated/prisma/enums";
import { can, isAdminRole } from "@/lib/auth/permissions";
import { inviteUser, normalizeEmail, revokeUser, type AuthApi } from "@/lib/auth/operator";

/**
 * Pengaturan → Tim (ADR 0017 §5): the organisation's own people management. The caller has already passed
 * requireCapability("members.manage") (or "org.transfer"); these functions enforce what depends on the people involved:
 * an ADMIN never touches an OWNER or makes one, nobody changes or disables themselves here, the last active OWNER stays,
 * and the seat limit counts active members.
 */
export class TeamError extends Error {}

export type Actor = { id: string; role: MemberRole; firmId: string };

export async function listTeam(db: Db, firmId: string) {
  const [members, clients, firm] = await Promise.all([
    db.firmMember.findMany({ where: { firmId }, include: { clientAccess: { select: { clientId: true } } }, orderBy: [{ disabled: "asc" }, { name: "asc" }] }),
    db.client.findMany({ where: { firmId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.firm.findUniqueOrThrow({ where: { id: firmId }, select: { kind: true, seatLimit: true } }),
  ]);
  return { members, clients, seatLimit: firm.seatLimit, kind: firm.kind, active: members.filter((m) => !m.disabled).length };
}

async function target(db: Db, actor: Actor, memberId: string) {
  const member = await db.firmMember.findFirst({ where: { id: memberId, firmId: actor.firmId } });
  if (!member) throw new TeamError("Anggota tidak ditemukan.");
  if (member.id === actor.id) throw new TeamError("Peran dan akses Anda sendiri diubah oleh pemilik atau admin lain.");
  if (member.role === "OWNER" && actor.role !== "OWNER") throw new TeamError("Hanya pemilik yang dapat mengubah pemilik lain.");
  return member;
}

/** Refuses when `memberId` is the organisation's only active OWNER (an organisation without any OWNER yet is left alone). */
async function keepLastOwner(db: Db, firmId: string, memberId: string) {
  const owners = await db.firmMember.findMany({ where: { firmId, role: "OWNER", disabled: false }, select: { id: true } });
  if (owners.length === 1 && owners[0].id === memberId) throw new TeamError("Organisasi perlu setidaknya satu pemilik aktif. Pindahkan kepemilikan dulu.");
}

async function seatFree(db: Db, firmId: string) {
  const firm = await db.firm.findUniqueOrThrow({ where: { id: firmId }, select: { seatLimit: true } });
  if (firm.seatLimit === null) return;
  const active = await db.firmMember.count({ where: { firmId, disabled: false } });
  if (active >= firm.seatLimit) throw new TeamError(`Batas ${firm.seatLimit} anggota aktif sudah tercapai. Nonaktifkan anggota lain atau hubungi Buku.`);
}

function grantableBy(actor: Actor, role: MemberRole) {
  if (role === "OWNER" && actor.role !== "OWNER") throw new TeamError("Hanya pemilik yang dapat menjadikan anggota pemilik.");
}

/** Clients of the organisation only; anything else is refused rather than silently dropped. */
async function ownClients(db: Db, firmId: string, clientIds: string[]) {
  const unique = [...new Set(clientIds)];
  const found = await db.client.count({ where: { firmId, id: { in: unique } } });
  if (found !== unique.length) throw new TeamError("Klien tidak ditemukan.");
  return unique;
}

/** Invite by email: the Supabase invitation (lib/auth/operator.ts) plus the clients an AKUNTAN or VIEWER may open. */
export async function inviteMember(db: Db, auth: AuthApi, actor: Actor, input: { email: string; name: string; role: MemberRole; clientIds: string[]; redirectTo?: string }) {
  grantableBy(actor, input.role);
  if (!input.name.trim()) throw new TeamError("Tulis nama anggota.");
  let email: string;
  try { email = normalizeEmail(input.email); } catch { throw new TeamError("Tulis alamat email yang valid."); }
  const existing = await db.firmMember.findUnique({ where: { email } });
  if (existing && existing.firmId === actor.firmId && !existing.disabled) throw new TeamError("Alamat ini sudah menjadi anggota aktif.");
  if (existing && existing.firmId !== actor.firmId) throw new TeamError("Alamat ini sudah terhubung ke organisasi lain di Buku.");
  if (existing?.role === "OWNER" && actor.role !== "OWNER") throw new TeamError("Hanya pemilik yang dapat mengubah pemilik lain.");
  const clientIds = isAdminRole(input.role) ? [] : await ownClients(db, actor.firmId, input.clientIds);
  await seatFree(db, actor.firmId);
  const member = await inviteUser(db, auth, { email, name: input.name, role: input.role, firmId: actor.firmId, redirectTo: input.redirectTo });
  await db.$transaction([
    db.clientAccess.deleteMany({ where: { memberId: member.id } }),
    db.clientAccess.createMany({ data: clientIds.map((clientId) => ({ memberId: member.id, clientId })) }),
  ]);
  return member;
}

export async function setRole(db: Db, actor: Actor, memberId: string, role: MemberRole) {
  const member = await target(db, actor, memberId);
  grantableBy(actor, role);
  if (member.role === "OWNER" && role !== "OWNER") await keepLastOwner(db, actor.firmId, member.id);
  return db.firmMember.update({ where: { id: member.id }, data: { role } });
}

/** Which clients an AKUNTAN or VIEWER may open; OWNER and ADMIN see every client and keep no list. */
export async function assignClients(db: Db, actor: Actor, memberId: string, clientIds: string[]) {
  const member = await target(db, actor, memberId);
  if (isAdminRole(member.role)) throw new TeamError("Pemilik dan admin melihat semua klien.");
  const ids = await ownClients(db, actor.firmId, clientIds);
  await db.$transaction([
    db.clientAccess.deleteMany({ where: { memberId: member.id } }),
    db.clientAccess.createMany({ data: ids.map((clientId) => ({ memberId: member.id, clientId })) }),
  ]);
}

/** Disabling closes the workspace at once and bans the login (operator revoke); enabling lifts both without an email. */
export async function setDisabled(db: Db, auth: AuthApi, actor: Actor, memberId: string, disabled: boolean) {
  const member = await target(db, actor, memberId);
  if (disabled) {
    if (member.role === "OWNER") await keepLastOwner(db, actor.firmId, member.id);
    return revokeUser(db, auth, { email: member.email, firmId: actor.firmId });
  }
  if (!member.disabled) return member;
  await seatFree(db, actor.firmId);
  const lifted = await auth.admin.updateUserById(member.userId, { ban_duration: "none" });
  if (lifted.error) throw new TeamError("Akses belum bisa dipulihkan. Coba lagi.");
  return db.firmMember.update({ where: { id: member.id }, data: { disabled: false } });
}

/** The OWNER hands ownership to an active member and becomes ADMIN, in one step. */
export async function transferOwnership(db: Db, actor: Actor, memberId: string) {
  if (!can(actor.role, "org.transfer")) throw new TeamError("Hanya pemilik yang dapat memindahkan kepemilikan.");
  const member = await target(db, actor, memberId);
  if (member.disabled) throw new TeamError("Aktifkan anggota ini dulu.");
  await db.$transaction([
    db.firmMember.update({ where: { id: member.id }, data: { role: "OWNER" } }),
    db.firmMember.update({ where: { id: actor.id }, data: { role: "ADMIN" } }),
  ]);
}
