import type { Db } from "@/lib/db";
import { accessState } from "@/lib/access/grant";
import { monthlyAiUse } from "@/lib/ai/budget";

/**
 * The backoffice's list of organisations (ADR 0017 §2): who they are, how much they use, and their access right now. Metadata only:
 * counts and dates, never a client name, an amount or a document. Books are seen only through a support session (T18).
 */
export async function listOrganisations(db: Db, now = new Date()) {
  const [firms, entities, activity] = await Promise.all([
    db.firm.findMany({
      include: { grants: true, members: { select: { email: true, role: true, disabled: true, createdAt: true }, orderBy: { createdAt: "asc" } }, _count: { select: { clients: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.entity.groupBy({ by: ["firmId"], _count: { _all: true } }),
    db.journalEntry.groupBy({ by: ["firmId"], _max: { createdAt: true } }),
  ]);
  const entityCount = new Map(entities.map((e) => [e.firmId, e._count._all]));
  const lastEntry = new Map(activity.map((a) => [a.firmId, a._max.createdAt]));
  return Promise.all(firms.map(async (firm) => {
    const active = firm.members.filter((m) => !m.disabled);
    const owner = active.find((m) => m.role === "OWNER") ?? active.find((m) => m.role === "ADMIN") ?? null;
    return {
      id: firm.id,
      name: firm.name,
      kind: firm.kind,
      createdAt: firm.createdAt,
      ownerEmail: owner?.email ?? null,
      members: active.length,
      seatLimit: firm.seatLimit,
      clients: firm._count.clients,
      entities: entityCount.get(firm.id) ?? 0,
      aiTokens: (await monthlyAiUse(db, firm.id)).spent,
      lastActivity: lastEntry.get(firm.id) ?? null,
      suspended: Boolean(firm.suspendedAt),
      access: accessState(firm.grants, firm, now),
    };
  }));
}
export type OrganisationRow = Awaited<ReturnType<typeof listOrganisations>>[number];

/** One organisation for its backoffice page: grants, people and Buku's log of what was done to it. Still no books. */
export async function organisationDetail(db: Db, firmId: string, now = new Date()) {
  const firm = await db.firm.findUnique({
    where: { id: firmId },
    include: {
      grants: { include: { grantedBy: { select: { name: true } }, revokedBy: { select: { name: true } } }, orderBy: { startsAt: "desc" } },
      members: { select: { id: true, email: true, name: true, role: true, disabled: true }, orderBy: [{ disabled: "asc" }, { createdAt: "asc" }] },
      _count: { select: { clients: true } },
    },
  });
  if (!firm) return null;
  const events = await db.platformAuditEvent.findMany({ where: { firmId }, include: { admin: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 50 });
  return { firm, access: accessState(firm.grants, firm, now), events, aiUse: await monthlyAiUse(db, firmId) };
}
