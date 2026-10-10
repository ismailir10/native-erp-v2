"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { AccessAdminError, createOrganisation, extendGrant, grantAccess, revokeGrant, setLimits, setSuspended, type GrantInput } from "@/lib/access/admin";
import { inviteUser } from "@/lib/auth/operator";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { appUrl } from "@/lib/supabase/env";
import { userMessage } from "@/lib/errors/user-message";
import type { GrantKind, MemberRole, OrgKind } from "@/lib/generated/prisma/enums";

/** Backoffice writes (ADR 0017 §2–3): Buku admins only; every change is logged in lib/access/admin.ts. */
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const KINDS: GrantKind[] = ["TRIAL", "PAID", "COMP"];
const ORG_KINDS: OrgKind[] = ["KANTOR_AKUNTAN", "PERUSAHAAN"];

function grantInput(input: { kind: string; startsOn?: string; endsOn?: string | null; note?: string }): GrantInput {
  if (!KINDS.includes(input.kind as GrantKind)) throw new AccessAdminError("Pilih jenis akses.");
  return { kind: input.kind as GrantKind, startsOn: input.startsOn || undefined, endsOn: input.endsOn || null, note: input.note };
}

async function run<T extends object>(work: (adminId: string) => Promise<T>, revalidate: string[] = ["/backoffice"]): Promise<Result<T>> {
  try {
    const admin = await requirePlatformAdmin({ refuse: "error" });
    const data = await work(admin.id);
    for (const path of revalidate) revalidatePath(path);
    return { ok: true, ...data };
  } catch (e) {
    if (e instanceof AccessAdminError || (e instanceof Error && e.message === "Hanya admin Buku yang dapat mengubah ini.")) return { ok: false, error: e.message };
    return { ok: false, error: userMessage(e, "Perubahan belum tersimpan. Coba lagi.") };
  }
}

export async function createOrganisationAction(input: { name: string; kind: string; grant: { kind: string; endsOn: string | null; note?: string }; seatLimit?: number | null }) {
  return run(async (adminId) => {
    if (!ORG_KINDS.includes(input.kind as OrgKind)) throw new AccessAdminError("Pilih jenis organisasi.");
    const firm = await createOrganisation(prisma, adminId, { name: String(input.name ?? ""), kind: input.kind as OrgKind, grant: grantInput(input.grant), seatLimit: input.seatLimit ?? null });
    return { firmId: firm.id };
  });
}

export async function grantAccessAction(firmId: string, input: { kind: string; startsOn?: string; endsOn: string | null; note?: string }) {
  return run(async (adminId) => { await grantAccess(prisma, adminId, String(firmId), grantInput(input)); return {}; }, ["/backoffice", `/backoffice/orgs/${firmId}`]);
}

export async function extendGrantAction(firmId: string, grantId: string, endsOn: string | null) {
  return run(async (adminId) => { await extendGrant(prisma, adminId, String(grantId), endsOn || null); return {}; }, ["/backoffice", `/backoffice/orgs/${firmId}`]);
}

export async function revokeGrantAction(firmId: string, grantId: string, reason: string) {
  return run(async (adminId) => { await revokeGrant(prisma, adminId, String(grantId), String(reason ?? "")); return {}; }, ["/backoffice", `/backoffice/orgs/${firmId}`]);
}

export async function setSuspendedAction(firmId: string, suspended: boolean, reason: string) {
  return run(async (adminId) => { await setSuspended(prisma, adminId, String(firmId), suspended === true, String(reason ?? "")); return {}; }, ["/backoffice", `/backoffice/orgs/${firmId}`]);
}

export async function setLimitsAction(firmId: string, input: { seatLimit: number | null; aiMonthlyTokenBudget: number | null }) {
  return run(async (adminId) => { await setLimits(prisma, adminId, String(firmId), { seatLimit: input.seatLimit ?? null, aiMonthlyTokenBudget: input.aiMonthlyTokenBudget ?? null }); return {}; }, ["/backoffice", `/backoffice/orgs/${firmId}`]);
}

/** The organisation's first people (usually its owner); later members are invited by the organisation itself in Pengaturan → Tim. */
export async function inviteMemberAction(firmId: string, input: { email: string; name: string; role: string }) {
  return run(async (adminId) => {
    const role = (["OWNER", "ADMIN"] as MemberRole[]).find((r) => r === input.role);
    if (!role) throw new AccessAdminError("Pilih peran pemilik atau admin.");
    let member;
    try {
      member = await inviteUser(prisma, createSupabaseAdmin().auth, { firmId: String(firmId), email: String(input.email ?? ""), name: String(input.name ?? ""), role, redirectTo: appUrl() || undefined });
    } catch (e) {
      // inviteUser's own refusals are Bahasa and safe to show; a database error (it has a code) stays behind userMessage.
      if (e instanceof Error && !("code" in e)) throw new AccessAdminError(e.message);
      throw e;
    }
    await prisma.platformAuditEvent.create({ data: { adminId, firmId: String(firmId), kind: "MEMBER_INVITED", summary: `${member.email} diundang sebagai ${role === "OWNER" ? "pemilik" : "admin"}` } });
    return {};
  }, [`/backoffice/orgs/${firmId}`]);
}
