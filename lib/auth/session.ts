import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function getWorkspaceSession() {
  const result = await getAuth().api.getSession({ headers: await headers() });
  if (!result) return null;
  // Always consult the live user. Revocation takes effect even for an in-flight session creation.
  const user = await prisma.authUser.findUnique({ where: { id: result.user.id }, include: { firm: true } });
  if (!user || user.disabled) return null;
  return { session: result.session, user, firm: user.firm };
}

export async function requireWorkspaceSession() {
  const session = await getWorkspaceSession();
  if (!session) redirect("/login");
  return session;
}
