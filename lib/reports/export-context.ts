import { prisma } from "@/lib/db";
import { findClientForMember, getCurrentFirm } from "@/lib/tenant";
import { parsePeriod, resolveEntityScope } from "@/lib/scope";
import { reasonText, reportStatus } from "@/lib/reports/status";

/**
 * What both statement downloads (Excel and PDF) need from `?entity=<id|combined>&period=YYYY-MM`: the client in the firm, the scope, the
 * period, the title, and why the statements are still a draft (absent once the month is closed). Null when the client isn't the firm's.
 */
export async function exportContext(req: Request, clientId: string) {
  const client = await findClientForMember(clientId);
  if (!client) return null;
  const url = new URL(req.url);
  const scope = resolveEntityScope(url.searchParams.get("entity") ?? undefined, client.entities);
  const now = new Date();
  const period = parsePeriod(url.searchParams.get("period") ?? undefined, { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });
  const title = scope.mode === "combined" ? `${client.name} (gabungan)` : client.entities.find((e) => e.id === scope.value)!.name;
  const firm = await getCurrentFirm();
  const status = await reportStatus(prisma, client.id, scope.entityIds, period.year, period.month);
  const draft = status.locked ? undefined : status.reasons.length ? `belum final: ${status.reasons.map(reasonText).join("; ")}; bulan belum ditutup.` : "bulan belum ditutup.";
  return { client, scope: { clientId: client.id, entityIds: scope.entityIds }, period, title, meta: { firm: firm.name, title, draft } };
}
