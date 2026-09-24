import { prisma } from "@/lib/db";
import { createFirm } from "@/lib/setup";

/**
 * Tenancy seam. Auth is out of scope for the MVP: the "current firm" is the first firm in the database
 * (the seeded demo firm, or on a real-data deployment the firm created on first visit).
 * When auth lands, resolve the firm from the session here — every query already filters by it.
 */
export async function getCurrentFirm() {
  const firm = await prisma.firm.findFirst({ orderBy: { createdAt: "asc" } });
  if (firm) return firm;
  if (process.env.DEMO_MODE === "true") throw new Error("Belum ada data demo. Jalankan `npm run demo:reset`.");
  return createFirstFirm();
}

/** Real-data deployments start empty. Advisory lock so two first requests don't create two firms. */
async function createFirstFirm() {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(4242)::text`;
    const existing = await tx.firm.findFirst({ orderBy: { createdAt: "asc" } });
    return existing ?? createFirm(tx, "Kantor Anda");
  });
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
