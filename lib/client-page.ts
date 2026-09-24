import { prisma } from "@/lib/db";
import { getClientForFirm } from "@/lib/tenant";
import { formatPeriod } from "@/lib/format";
import { parsePeriod, resolveEntityScope, type SearchParams } from "@/lib/scope";

/** Everything a client page needs from URL params, resolved + tenant-checked once. */
export async function loadClientPage(params: Promise<{ id: string }>, searchParams: SearchParams, opts: { defaultCombined?: boolean } = {}) {
  const { id } = await params;
  const sp = await searchParams;
  const client = await getClientForFirm(id);
  const period = parsePeriod(sp.period);
  const scope = resolveEntityScope(sp.entity, client.entities, opts.defaultCombined ?? true);
  const periods = await prisma.period.findMany({ where: { clientId: id }, orderBy: [{ year: "desc" }, { month: "desc" }] });
  const periodOptions = periods.map((p) => ({ value: `${p.year}-${String(p.month).padStart(2, "0")}`, label: `${formatPeriod(p.year, p.month)}${p.status === "LOCKED" ? " · ditutup" : ""}` }));
  if (!periodOptions.some((o) => o.value === period.key)) periodOptions.unshift({ value: period.key, label: formatPeriod(period.year, period.month) });
  const entityOptions = client.entities.map((e) => ({ value: e.id, label: e.name }));
  const scopeLabel = scope.mode === "combined" ? "Gabungan Grup" : client.entities.find((e) => e.id === scope.value)!.name;
  const base = `/clients/${id}`;
  return { client, period, scope, periodOptions, entityOptions, scopeLabel, base, sp };
}
