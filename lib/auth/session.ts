import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { authConfigured } from "@/lib/auth";
import { prisma, type Db } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MemberRole } from "@/lib/generated/prisma/enums";
import { can, capabilityRefusal, isAdminRole, isWrite, type Capability } from "@/lib/auth/permissions";
import { accessState, readOnlyMessage, type Access } from "@/lib/access/grant";
import { resolveSupportSession, SUPPORT_COOKIE, SUPPORT_READ_ONLY } from "@/lib/auth/support";

export { ROLE_LABEL } from "@/lib/auth/permissions";

/** A refusal a form or toast shows as is (Bahasa). Server actions return its message; pages turn it into 404 or a redirect. */
export class AccessError extends Error {
  constructor(message: string, readonly reason: "SIGNED_OUT" | "CLOSED" | "READ_ONLY" | "ROLE" | "CLIENT" | "SUPPORT") {
    super(message);
    this.name = "AccessError";
  }
}

export const CLIENT_NOT_FOUND = "Klien tidak ditemukan";
export const ACCESS_CLOSED = "Akses ruang kerja ini ditutup. Hubungi Buku.";

/**
 * One organisation member's view of Buku for this request (ADR 0017): who they are, their organisation, its access state right
 * now, and which clients they may open ("ALL" for OWNER/ADMIN and for every member of a company, whose one client is its books).
 */
export type WorkspaceSession = NonNullable<Awaited<ReturnType<typeof resolveWorkspace>>>;

/** A Buku admin's support session behind this request (ADR 0017 §2), shown only to that admin; null for everyone else. */
export type SupportInfo = { id: string; adminName: string; firmId: string; firmName: string; memberName: string; expiresAt: Date };

async function loadMember(db: Db, where: { userId: string } | { id: string }) {
  return db.firmMember.findUnique({ where, include: { firm: { include: { grants: true } }, clientAccess: { select: { clientId: true } } } });
}

function shape(member: NonNullable<Awaited<ReturnType<typeof loadMember>>>, now: Date, support: SupportInfo | null) {
  const { firm: withGrants, clientAccess, ...rest } = member;
  const { grants, ...firm } = withGrants;
  const access: Access = accessState(grants, firm, now);
  const clientIds: string[] | "ALL" = isAdminRole(member.role) || firm.kind === "PERUSAHAAN" ? "ALL" : clientAccess.map((a) => a.clientId);
  return { member: rest, user: rest, firm, access, clientIds, support };
}

/** The member row of a verified user, read live (a disabled member, ended grant or suspension takes effect at once). */
export async function resolveWorkspace(db: Db, userId: string, now = new Date()) {
  const member = await loadMember(db, { userId });
  if (!member || member.disabled) return null;
  return shape(member, now, null);
}

/** A support session's view: exactly the member's own (role, assignments), whatever their state, marked as support. */
export async function resolveSupportWorkspace(db: Db, memberId: string, support: SupportInfo, now = new Date()) {
  const member = await loadMember(db, { id: memberId });
  return member && member.firmId === support.firmId ? shape(member, now, support) : null;
}

/** The support session id this browser carries; none outside a request (tests, scripts), where `cookies()` is unavailable. */
async function supportCookie() {
  try { return (await cookies()).get(SUPPORT_COOKIE)?.value; } catch { return undefined; }
}

/** The verified Supabase session resolved to an organisation member, once per request. JWT verified locally (`getClaims`). */
export const getWorkspaceSession = cache(async () => {
  if (!authConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return null;
  // A Buku admin with a live support session sees the chosen member's workspace instead of their own (ADR 0017 §2).
  const supportId = await supportCookie();
  if (supportId) {
    const aal = (data?.claims as { aal?: string } | undefined)?.aal ?? "aal1";
    const live = await resolveSupportSession(prisma, userId, aal, supportId);
    if (live) {
      const member = await prisma.firmMember.findUnique({ where: { id: live.session.asMemberId }, select: { name: true } });
      const support: SupportInfo = { id: live.session.id, adminName: live.admin.name, firmId: live.session.firmId, firmName: live.session.firm.name, memberName: member?.name ?? "", expiresAt: live.session.expiresAt };
      const session = await resolveSupportWorkspace(prisma, live.session.asMemberId, support);
      if (session) return session;
    }
  }
  return resolveWorkspace(prisma, userId);
});

/** Pages: signed out → /login; organisation closed (no grant, revoked, suspended) → /akses-ditutup. */
export async function requireWorkspaceSession() {
  const session = await getWorkspaceSession();
  if (!session) redirect("/login");
  // Troubleshooting a closed organisation is part of support: a support session reads whatever the access state.
  if (session.access.state === "NONE" && !session.support) redirect("/akses-ditutup");
  return session;
}

/** Evidence intakes this session may open: unlinked ones (the firm's inbox) and those of its clients. */
export function intakeVisibleWhere(session: Pick<WorkspaceSession, "clientIds">) {
  return session.clientIds === "ALL" ? {} : { OR: [{ clientId: null }, { clientId: { in: session.clientIds } }] };
}

/** The session's access for lib/workspace (scope, overview, answers). */
export const workspaceAccess = (session: Pick<WorkspaceSession, "firm" | "clientIds">) => ({ firmId: session.firm.id, clientIds: session.clientIds });

/** The Prisma `where` for the clients this session may open. Every client list goes through it. */
export function accessibleClientWhere(session: Pick<WorkspaceSession, "firm" | "clientIds">) {
  return session.clientIds === "ALL" ? { firmId: session.firm.id } : { firmId: session.firm.id, id: { in: session.clientIds } };
}

/**
 * The one guard every write path calls: organisation open, writes allowed right now, the role has the capability, and (when a
 * client is named) the client is this member's. A foreign or unassigned client reads exactly like a missing one.
 */
export async function checkCapability(db: Db, session: WorkspaceSession | null, capability: Capability, opts: { clientId?: string } = {}) {
  if (!session) throw new AccessError("Masuk terlebih dahulu.", "SIGNED_OUT");
  // A support session never writes: entries record who made them, and posting as the client would falsify that (ADR 0017 §2).
  if (session.support && isWrite(capability)) throw new AccessError(SUPPORT_READ_ONLY, "SUPPORT");
  if (session.access.state === "NONE" && !session.support) throw new AccessError(ACCESS_CLOSED, "CLOSED");
  if (isWrite(capability) && session.access.state === "READ_ONLY") throw new AccessError(readOnlyMessage(session.access), "READ_ONLY");
  if (!can(session.member.role, capability)) throw new AccessError(capabilityRefusal(capability), "ROLE");
  if (opts.clientId !== undefined) {
    // AND, never a spread: an assignment list is itself a condition on `id` and must not be overwritten by the requested id.
    const found = await db.client.findFirst({ where: { AND: [accessibleClientWhere(session), { id: opts.clientId }] }, select: { id: true } });
    if (!found) throw new AccessError(CLIENT_NOT_FOUND, "CLIENT");
  }
  return session;
}

/** What the write controls of client components need to know (components/app/access-context.tsx). */
export function accessView(session: Pick<WorkspaceSession, "access" | "member" | "support">) {
  if (session.support) return { canWrite: false, reason: SUPPORT_READ_ONLY };
  if (session.access.state === "READ_ONLY") return { canWrite: false, reason: readOnlyMessage(session.access) };
  if (!can(session.member.role, "books.write")) return { canWrite: false, reason: capabilityRefusal("books.write") };
  return { canWrite: true, reason: null };
}

/** For server actions: an error, not a redirect, so the form can show it. */
export async function requireCapability(capability: Capability, opts: { clientId?: string } = {}) {
  return checkCapability(prisma, await getWorkspaceSession(), capability, opts);
}

/** Older call sites: any member (reads) or an admin. New code uses requireCapability with a named capability. */
export async function requireMember(role?: Extract<MemberRole, "ADMIN">) {
  const session = await checkCapability(prisma, await getWorkspaceSession(), role ? "org.settings" : "books.read");
  return session.member;
}
