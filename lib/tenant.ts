import { prisma } from "@/lib/db";
import { requireWorkspaceSession } from "@/lib/auth/session";

/** Every query resolves its firm from a verified, active invitation. */
export async function getCurrentFirm() {
  return (await requireWorkspaceSession()).firm;
}

/** The member behind the request, for attribution on what they post, tick or lock. */
export async function getCurrentMember() {
  return (await requireWorkspaceSession()).member;
}

export async function getClientForFirm(clientId: string) {
  const firm = await getCurrentFirm();
  const client = await prisma.client.findFirst({
    where: { id: clientId, firmId: firm.id },
    include: { entities: { include: { bankAccounts: { include: { account: true } } }, orderBy: { name: "asc" } } },
  });
  if (!client) throw new Error("Klien tidak ditemukan");
  // Companies before individuals everywhere entities are listed (PT/CV/foreign, then the owner); bank accounts by code.
  client.entities.sort((x, y) => Number(x.kind === "PERORANGAN") - Number(y.kind === "PERORANGAN") || x.name.localeCompare(y.name, "id"));
  for (const e of client.entities) e.bankAccounts.sort((x, y) => x.account.code.localeCompare(y.account.code));
  return client;
}
