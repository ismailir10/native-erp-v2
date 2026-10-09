import { redirect } from "next/navigation";
import { authConfigured } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MemberRole } from "@/lib/generated/prisma/enums";
import { isAdminRole } from "@/lib/auth/permissions";

export { ROLE_LABEL } from "@/lib/auth/permissions";

/**
 * The verified Supabase session resolved to an active firm member. The JWT is verified locally
 * (`getClaims`, no round trip per request); the member row is consulted live on every request,
 * so a revocation takes effect immediately, whatever the token still says.
 */
export async function getWorkspaceSession() {
  if (!authConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return null;
  const member = await prisma.firmMember.findUnique({ where: { userId }, include: { firm: true } });
  if (!member || member.disabled) return null;
  return { member, user: member, firm: member.firm };
}

export async function requireWorkspaceSession() {
  const session = await getWorkspaceSession();
  if (!session) redirect("/login");
  return session;
}

/** For server actions: an error, not a redirect, so the form can show it. */
export async function requireMember(role?: Extract<MemberRole, "ADMIN">) {
  const session = await getWorkspaceSession();
  if (!session) throw new Error("Masuk terlebih dahulu.");
  if (role && !isAdminRole(session.member.role)) throw new Error("Hanya admin kantor yang dapat mengubah ini.");
  return session.member;
}
