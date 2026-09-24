import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { getClientForFirm } from "@/lib/tenant";
import { formatPeriod } from "@/lib/format";
import { parsePeriod, resolveEntityScope, type SearchParams } from "@/lib/scope";
import { dataMonths } from "@/lib/periods";

/** Everything a client page needs from URL params, resolved + tenant-checked once. */
export async function loadClientPage(params: Promise<{ id: string }>, searchParams: SearchParams, opts: { defaultCombined?: boolean } = {}) {
  const { id } = await params;
  const sp = await searchParams;
  // Unknown or other-firm client → 404 page, not a 500.
  const client = await getClientForFirm(id).catch(() => notFound());
  const months = await dataMonths([id]);
  const period = parsePeriod(sp.period, months[0] ?? { year: new Date().getUTCFullYear(), month: new Date().getUTCMonth() + 1 });
  const scope = resolveEntityScope(sp.entity, client.entities, opts.defaultCombined ?? true);
  const locked = new Set(
    (await prisma.period.findMany({ where: { clientId: id, status: "LOCKED" } })).map((p) => `${p.year}-${p.month}`),
  );
  // Only months with bank data — the opening-balance month would be an empty, confusing option.
  const periodOptions = months.map((p) => ({
    value: `${p.year}-${String(p.month).padStart(2, "0")}`,
    label: `${formatPeriod(p.year, p.month)}${locked.has(`${p.year}-${p.month}`) ? " · ditutup" : ""}`,
  }));
  if (!periodOptions.some((o) => o.value === period.key)) periodOptions.unshift({ value: period.key, label: formatPeriod(period.year, period.month) });
  const entityOptions = client.entities.map((e) => ({ value: e.id, label: e.name }));
  const scopeLabel = scope.mode === "combined" ? "Gabungan Grup" : client.entities.find((e) => e.id === scope.value)!.name;
  const base = `/clients/${id}`;
  return { client, period, scope, periodOptions, entityOptions, scopeLabel, base, sp };
}
