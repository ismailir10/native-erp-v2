import type { Tx } from "@/lib/db";
import type { OrgKind } from "@/lib/generated/prisma/enums";

/**
 * Organisation kinds (ADR 0017 §1). A company (PERUSAHAAN) keeps its own books: exactly one Client, which is the company, with
 * its entities. The UI hides the client layer; these checks keep the data shaped that way whatever the caller.
 */
export class OrgError extends Error {}

export const isCompany = (firm: { kind: OrgKind }) => firm.kind === "PERUSAHAAN";

export const COMPANY_ONE_CLIENT = "Perusahaan memiliki satu buku. Tambahkan perusahaan anak atau pemilik sebagai entitas di Pengaturan buku.";
export const COMPANY_NO_DELETE = "Buku perusahaan tidak dapat dihapus dari sini. Hubungi Buku untuk menutup organisasi.";

/** Refuses a second client in a company. The first one (created with the organisation) passes. */
export async function assertCanAddClient(tx: Tx, firmId: string) {
  const firm = await tx.firm.findUniqueOrThrow({ where: { id: firmId }, select: { kind: true, _count: { select: { clients: true } } } });
  if (isCompany(firm) && firm._count.clients > 0) throw new OrgError(COMPANY_ONE_CLIENT);
}

/** The one client that is a company's books, or null for a firm (or a company not set up yet). */
export async function companyClient(tx: Tx, firm: { id: string; kind: OrgKind }) {
  if (!isCompany(firm)) return null;
  return tx.client.findFirst({ where: { firmId: firm.id }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
}
