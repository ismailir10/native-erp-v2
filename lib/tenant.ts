import { prisma } from "@/lib/db";
import { requireWorkspaceSession } from "@/lib/auth/session";

/** Every query resolves its firm from a verified, active invitation. */
export async function getCurrentFirm() {
  return (await requireWorkspaceSession()).firm;
}

export async function getClientForFirm(clientId: string) {
  const firm = await getCurrentFirm();
  const client = await prisma.client.findFirst({
    where: { id: clientId, firmId: firm.id },
    include: { entities: { include: { bankAccounts: { include: { account: true } } }, orderBy: { name: "asc" } } },
  });
  if (!client) throw new Error("Klien tidak ditemukan");
  return client;
}
