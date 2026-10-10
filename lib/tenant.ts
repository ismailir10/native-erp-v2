import { prisma } from "@/lib/db";
import { AccessError, accessibleClientWhere, CLIENT_NOT_FOUND, requireWorkspaceSession } from "@/lib/auth/session";

/** Every query resolves its organisation from a verified, active membership. */
export async function getCurrentFirm() {
  return (await requireWorkspaceSession()).firm;
}

/** The member behind the request, for attribution on what they post, tick or lock. */
export async function getCurrentMember() {
  return (await requireWorkspaceSession()).member;
}

/**
 * A client the member may open: in their organisation and, for AKUNTAN/VIEWER, assigned to them. Anything else throws the
 * same "not found" as a missing id, so a URL never tells whether another organisation's client exists.
 */
export async function getClientForMember(clientId: string) {
  const session = await requireWorkspaceSession();
  const client = await prisma.client.findFirst({
    // AND, never a spread: an assignment list is itself a condition on `id` and must not be overwritten by the requested id.
    where: { AND: [accessibleClientWhere(session), { id: clientId }] },
    include: { entities: { include: { bankAccounts: { include: { account: true } } }, orderBy: { name: "asc" } } },
  });
  if (!client) throw new AccessError(CLIENT_NOT_FOUND, "CLIENT");
  // Companies before individuals everywhere entities are listed (PT/CV/foreign, then the owner); bank accounts by code.
  client.entities.sort((x, y) => Number(x.kind === "PERORANGAN") - Number(y.kind === "PERORANGAN") || x.name.localeCompare(y.name, "id"));
  for (const e of client.entities) e.bankAccounts.sort((x, y) => x.account.code.localeCompare(y.account.code));
  return client;
}

/**
 * As getClientForMember, for pages and downloads: null when the client is not the member's (the caller answers 404), while the
 * redirects of an unauthenticated or closed session still go through (a blanket .catch would turn them into 404s).
 */
export async function findClientForMember(clientId: string) {
  try {
    return await getClientForMember(clientId);
  } catch (e) {
    if (e instanceof AccessError) return null;
    throw e;
  }
}
