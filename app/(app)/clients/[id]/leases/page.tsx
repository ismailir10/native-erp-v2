import { prisma } from "@/lib/db";
import { loadClientPage } from "@/lib/client-page";
import type { SearchParams } from "@/lib/scope";
import { formatPeriod } from "@/lib/format";
import { ScopeBar } from "@/components/app/scope-bar";
import { NextStep, PageHeader } from "@/components/app/page-header";
import { LeaseRegister } from "@/components/app/lease-register";
import { leaseRegisterViews } from "@/lib/leases/view";

export const metadata = { title: "Sewa (PSAK 116)" };

export default async function LeasesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { client, period, scope, periodOptions, entityOptions, base } = await loadClientPage(params, searchParams);
  const entities = client.entities.filter((e) => scope.entityIds.includes(e.id));
  const registers = await leaseRegisterViews(prisma, client.id, period.year, period.month, entities);
  const label = formatPeriod(period.year, period.month);
  const due = registers.reduce((n, r) => n + r.due, 0);
  const mismatch = registers.filter((r) => r.ledger && !r.ledger.equal);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sewa (PSAK 116)"
        description={`${client.name} · aset hak guna, liabilitas sewa dan jurnal bulanannya per ${label}`}
        actions={<ScopeBar entities={entityOptions} periods={periodOptions} entity={scope.value} period={period.key} />}
      />
      {due ? (
        <NextStep>Catat {due} jurnal bulanan sewa s.d. {label} (penyusutan hak guna, bunga, reklasifikasi).</NextStep>
      ) : mismatch.length ? (
        <NextStep href={`${base}/review?period=${period.key}`} cta="Buka Review">
          Liabilitas sewa {mismatch.map((r) => r.entity.shortName).join(", ")} berbeda dengan buku besar. Klasifikasikan pembayaran sewa di rekening koran ke 2170.
        </NextStep>
      ) : registers.length ? (
        <NextStep tone="done">Daftar sewa per {label} cocok dengan buku besar dan semua jurnal bulanan sudah dicatat.</NextStep>
      ) : (
        <NextStep>Daftarkan sewa klien yang lebih dari 12 bulan (kantor, gudang, kendaraan) agar aset hak guna dan liabilitasnya tercatat.</NextStep>
      )}
      <LeaseRegister
        clientId={client.id}
        year={period.year}
        month={period.month}
        periodKey={period.key}
        periodLabel={label}
        entities={[...entities].sort((a, b) => Number(a.kind === "PERORANGAN") - Number(b.kind === "PERORANGAN")).map((e) => ({ id: e.id, name: e.name, currency: e.functionalCurrency }))}
        registers={registers}
      />
    </div>
  );
}
