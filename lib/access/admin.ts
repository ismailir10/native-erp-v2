import type { Db, Tx } from "@/lib/db";
import type { GrantKind, OrgKind } from "@/lib/generated/prisma/enums";
import type { Prisma } from "@/lib/generated/prisma/client";
import { createClient, createFirm } from "@/lib/setup";
import { endOfDayJakarta } from "@/lib/access/grant";
import { formatDateWib } from "@/lib/format";

/**
 * What a Buku admin does to an organisation (ADR 0017 §2–3): create it, give, extend or revoke access, suspend or reinstate it, set its
 * limits. Every change writes a PlatformAuditEvent (Buku's own log, never shown to the tenant). `adminId` null = the operator CLI.
 */
export class AccessAdminError extends Error {}

export type GrantInput = { kind: GrantKind; startsOn?: string; endsOn: string | null; note?: string };

const GRANT_LABEL: Record<GrantKind, string> = { TRIAL: "Uji coba", PAID: "Berbayar", COMP: "Gratis" };

function period(input: GrantInput, now: Date) {
  const startsAt = input.startsOn ? new Date(`${input.startsOn}T00:00:00+07:00`) : now;
  if (Number.isNaN(+startsAt)) throw new AccessAdminError("Tanggal mulai tidak valid.");
  let endsAt: Date | null = null;
  if (input.endsOn) {
    try { endsAt = endOfDayJakarta(input.endsOn); } catch { throw new AccessAdminError("Tanggal berakhir tidak valid."); }
    if (endsAt <= startsAt) throw new AccessAdminError("Tanggal berakhir harus sesudah tanggal mulai.");
  }
  return { startsAt, endsAt };
}

const until = (endsAt: Date | null) => (endsAt ? `s.d. ${formatDateWib(endsAt)}` : "tanpa batas");

async function log(tx: Tx | Db, adminId: string | null, firmId: string, kind: string, summary: string, before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue) {
  await tx.platformAuditEvent.create({ data: { adminId, firmId, kind, summary, before, after } });
}

/** A new organisation with its first grant; a company also gets its one client (its books) with the company as first entity. */
export async function createOrganisation(db: Db, adminId: string | null, input: OrganisationInput, now = new Date()) {
  return db.$transaction((tx) => createOrganisationTx(tx, adminId, input, now));
}

export type OrganisationInput = { name: string; kind: OrgKind; grant: GrantInput; seatLimit?: number | null };

/** As createOrganisation, inside the caller's transaction (a trial approval also invites the owner before it commits). */
export async function createOrganisationTx(tx: Tx, adminId: string | null, input: OrganisationInput, now = new Date()) {
  const name = input.name.trim();
  if (!name) throw new AccessAdminError("Tulis nama organisasi.");
  const { startsAt, endsAt } = period(input.grant, now);
  const firm = await createFirm(tx, name, { kind: input.kind, grant: { kind: input.grant.kind, startsAt, endsAt, note: input.grant.note?.trim() || undefined, grantedById: adminId ?? undefined } });
  if (input.seatLimit) await tx.firm.update({ where: { id: firm.id }, data: { seatLimit: input.seatLimit } });
  if (input.kind === "PERUSAHAAN") {
    await createClient(tx, firm.id, { name, industry: "", entities: [{ name, shortName: name.replace(/^(PT|CV)\.?\s+/i, "").slice(0, 24) || name, kind: "PT", banks: [] }] });
  }
  await log(tx, adminId, firm.id, "ORG_CREATED", `${input.kind === "PERUSAHAAN" ? "Perusahaan" : "Kantor akuntan"} ${name} dibuat · ${GRANT_LABEL[input.grant.kind]} ${until(endsAt)}`, undefined, { kind: input.kind, grant: input.grant.kind, endsAt: endsAt?.toISOString() ?? null });
  return { ...firm, endsAt };
}

export async function grantAccess(db: Db, adminId: string | null, firmId: string, input: GrantInput, now = new Date()) {
  const { startsAt, endsAt } = period(input, now);
  return db.$transaction(async (tx) => {
    await tx.firm.findUniqueOrThrow({ where: { id: firmId }, select: { id: true } }).catch(() => { throw new AccessAdminError("Organisasi tidak ditemukan."); });
    const grant = await tx.accessGrant.create({ data: { firmId, kind: input.kind, startsAt, endsAt, note: input.note?.trim() || null, grantedById: adminId } });
    await log(tx, adminId, firmId, "GRANT", `${GRANT_LABEL[input.kind]} ${until(endsAt)}${input.note?.trim() ? ` · ${input.note.trim()}` : ""}`, undefined, { grantId: grant.id, kind: input.kind, endsAt: endsAt?.toISOString() ?? null });
    return grant;
  });
}

/** A new end date for a running or ended grant (an extension, or a correction). Revoked grants stay revoked. */
export async function extendGrant(db: Db, adminId: string | null, grantId: string, endsOn: string | null) {
  return db.$transaction(async (tx) => {
    const grant = await tx.accessGrant.findUnique({ where: { id: grantId } });
    if (!grant) throw new AccessAdminError("Akses tidak ditemukan.");
    if (grant.revokedAt) throw new AccessAdminError("Akses ini sudah dicabut. Beri akses baru.");
    const { endsAt } = period({ kind: grant.kind, startsOn: undefined, endsOn }, grant.startsAt);
    const updated = await tx.accessGrant.update({ where: { id: grant.id }, data: { endsAt } });
    await log(tx, adminId, grant.firmId, "GRANT_EXTENDED", `${GRANT_LABEL[grant.kind]} diubah ${until(grant.endsAt)} → ${until(endsAt)}`, { endsAt: grant.endsAt?.toISOString() ?? null }, { endsAt: endsAt?.toISOString() ?? null });
    return updated;
  });
}

export async function revokeGrant(db: Db, adminId: string | null, grantId: string, reason: string, now = new Date()) {
  if (reason.trim().length < 5) throw new AccessAdminError("Tulis alasan mencabut akses (min. 5 karakter).");
  return db.$transaction(async (tx) => {
    const grant = await tx.accessGrant.findUnique({ where: { id: grantId } });
    if (!grant) throw new AccessAdminError("Akses tidak ditemukan.");
    if (grant.revokedAt) return grant;
    const updated = await tx.accessGrant.update({ where: { id: grant.id }, data: { revokedAt: now, revokedById: adminId } });
    await log(tx, adminId, grant.firmId, "GRANT_REVOKED", `${GRANT_LABEL[grant.kind]} ${until(grant.endsAt)} dicabut · ${reason.trim()}`);
    return updated;
  });
}

/** Suspension closes the workspace whatever the grants say (abuse, non-payment); reinstating restores what the grants give. */
export async function setSuspended(db: Db, adminId: string | null, firmId: string, suspended: boolean, reason: string, now = new Date()) {
  if (suspended && reason.trim().length < 5) throw new AccessAdminError("Tulis alasan penangguhan (min. 5 karakter).");
  return db.$transaction(async (tx) => {
    const firm = await tx.firm.findUnique({ where: { id: firmId } });
    if (!firm) throw new AccessAdminError("Organisasi tidak ditemukan.");
    if (Boolean(firm.suspendedAt) === suspended) return firm;
    const updated = await tx.firm.update({ where: { id: firmId }, data: { suspendedAt: suspended ? now : null } });
    await log(tx, adminId, firmId, suspended ? "SUSPENDED" : "REINSTATED", suspended ? `Ditangguhkan · ${reason.trim()}` : `Dipulihkan${reason.trim() ? ` · ${reason.trim()}` : ""}`);
    return updated;
  });
}

/** Seat limit and monthly AI token cap; null = no seat cap / the deployment's default budget. */
export async function setLimits(db: Db, adminId: string | null, firmId: string, input: { seatLimit: number | null; aiMonthlyTokenBudget: number | null }) {
  if (input.seatLimit !== null && (!Number.isSafeInteger(input.seatLimit) || input.seatLimit < 1)) throw new AccessAdminError("Batas anggota minimal 1, atau kosongkan.");
  if (input.aiMonthlyTokenBudget !== null && (!Number.isSafeInteger(input.aiMonthlyTokenBudget) || input.aiMonthlyTokenBudget < 0)) throw new AccessAdminError("Batas token AI tidak valid.");
  return db.$transaction(async (tx) => {
    const firm = await tx.firm.findUnique({ where: { id: firmId } });
    if (!firm) throw new AccessAdminError("Organisasi tidak ditemukan.");
    const updated = await tx.firm.update({ where: { id: firmId }, data: input });
    const fmt = (v: number | null, unit: string) => (v === null ? "bawaan" : `${v.toLocaleString("id-ID")} ${unit}`);
    await log(tx, adminId, firmId, "LIMITS", `Batas: ${fmt(input.seatLimit, "anggota")} · ${fmt(input.aiMonthlyTokenBudget, "token AI/bulan")}`,
      { seatLimit: firm.seatLimit, aiMonthlyTokenBudget: firm.aiMonthlyTokenBudget }, input);
    return updated;
  });
}
