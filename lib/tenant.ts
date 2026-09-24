import { prisma } from "@/lib/db";

/**
 * Tenancy seam. Auth is out of scope for the MVP: the "current firm" is the seeded demo firm.
 * When auth lands, resolve the firm from the session here — every query already filters by it.
 */
export async function getCurrentFirm() {
  const firm = await prisma.firm.findFirst({ orderBy: { createdAt: "asc" } });
  if (!firm) throw new Error("Belum ada data. Jalankan `npm run demo:reset`.");
  return firm;
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
