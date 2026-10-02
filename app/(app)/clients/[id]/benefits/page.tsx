import { prisma } from "@/lib/db";
import { loadClientPage } from "@/lib/client-page";
import type { SearchParams } from "@/lib/scope";
import { formatPeriod } from "@/lib/format";
import { ScopeBar } from "@/components/app/scope-bar";
import { NextStep, PageHeader } from "@/components/app/page-header";
import { EmployeeBenefits } from "@/components/app/employee-benefits";
import { benefitViews } from "@/lib/benefits/view";

export const metadata = { title: "Imbalan Kerja" };

export default async function BenefitsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { client, period, scope, periodOptions, entityOptions } = await loadClientPage(params, searchParams);
  const entities = client.entities.filter((e) => scope.entityIds.includes(e.id)).sort((a, b) => Number(a.kind === "PERORANGAN") - Number(b.kind === "PERORANGAN"));
  const [views, tables] = await Promise.all([
    benefitViews(prisma, client.id, period.year, period.month, entities),
    prisma.mortalityTable.findMany({ where: { firmId: client.firmId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const label = formatPeriod(period.year, period.month);
  const blocked = views.find((v) => v.valuation.blocker);
  const unposted = views.filter((v) => !v.valuation.blocker && v.valuation.lines.length && !v.valuation.later);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Imbalan Kerja (PSAK 24)"
        description={`${client.name} · liabilitas imbalan pasca kerja UU Cipta Kerja / PP 35/2021 per ${label}`}
        actions={<ScopeBar entities={entityOptions} periods={periodOptions} entity={scope.value} period={period.key} />}
      />
      {!tables.length ? (
        <NextStep>Unggah tabel mortalita kantor (mis. TMI IV 2019) sekali; dipakai semua klien.</NextStep>
      ) : blocked ? (
        <NextStep>{blocked.entity.shortName}: {blocked.valuation.blocker}</NextStep>
      ) : views.some((v) => !v.employees.length) ? (
        <NextStep>Impor sensus karyawan (Excel / CSV) atau tambahkan satu per satu.</NextStep>
      ) : unposted.length ? (
        <NextStep>Catat jurnal imbalan kerja {unposted.map((v) => v.entity.shortName).join(", ")} per {label}.</NextStep>
      ) : (
        <NextStep tone="done">Liabilitas imbalan kerja per {label} sesuai valuasi.</NextStep>
      )}
      <EmployeeBenefits clientId={client.id} year={period.year} month={period.month} periodKey={period.key} periodLabel={label} tables={tables} entities={views} />
    </div>
  );
}
