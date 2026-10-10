"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { AccessError, requireCapability } from "@/lib/auth/session";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { appUrl } from "@/lib/supabase/env";
import { assignClients, inviteMember, setDisabled, setRole, TeamError, transferOwnership, type Actor } from "@/lib/team";
import type { MemberRole } from "@/lib/generated/prisma/enums";

/** Pengaturan → Tim. Every action needs `members.manage` (transfer: `org.transfer`); lib/team.ts enforces the rules about people. */
type Result = { ok: true } | { ok: false; error: string };
const ROLES: readonly MemberRole[] = ["OWNER", "ADMIN", "AKUNTAN", "VIEWER"];

async function actor(capability: "members.manage" | "org.transfer" = "members.manage"): Promise<Actor> {
  const { member, firm } = await requireCapability(capability);
  return { id: member.id, role: member.role, firmId: firm.id };
}

function role(value: unknown): MemberRole {
  if (!ROLES.includes(value as MemberRole)) throw new TeamError("Pilih peran.");
  return value as MemberRole;
}

async function run(work: () => Promise<unknown>): Promise<Result> {
  try {
    await work();
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    if (e instanceof TeamError || e instanceof AccessError) return { ok: false, error: e.message };
    console.error("team action", e);
    return { ok: false, error: "Perubahan tim belum tersimpan. Coba lagi." };
  }
}

export async function inviteMemberAction(input: { email: string; name: string; role: string; clientIds: string[] }) {
  return run(async () => inviteMember(prisma, createSupabaseAdmin().auth, await actor(), { email: String(input.email ?? ""), name: String(input.name ?? ""), role: role(input.role), clientIds: Array.isArray(input.clientIds) ? input.clientIds.map(String) : [], redirectTo: appUrl() || undefined }));
}

export async function setRoleAction(memberId: string, next: string) {
  return run(async () => setRole(prisma, await actor(), String(memberId), role(next)));
}

export async function assignClientsAction(memberId: string, clientIds: string[]) {
  return run(async () => assignClients(prisma, await actor(), String(memberId), Array.isArray(clientIds) ? clientIds.map(String) : []));
}

export async function setDisabledAction(memberId: string, disabled: boolean) {
  return run(async () => setDisabled(prisma, createSupabaseAdmin().auth, await actor(), String(memberId), disabled === true));
}

export async function transferOwnershipAction(memberId: string) {
  return run(async () => transferOwnership(prisma, await actor("org.transfer"), String(memberId)));
}
