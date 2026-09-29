import { prisma } from "@/lib/db";
import { loadClientPage } from "@/lib/client-page";
import type { SearchParams } from "@/lib/scope";
import { formatPeriod, toIsoDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { ScopeBar } from "@/components/app/scope-bar";
import { NextStep, PageHeader } from "@/components/app/page-header";
import { Receivables } from "@/components/app/receivables";
import { receivablesView } from "@/lib/receivables/view";

export default async function ReceivablesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { client, period, scope, periodOptions, entityOptions, sp } = await loadClientPage(params, searchParams);
  const direction = sp.tab === "utang" ? "PURCHASE" : "SALES";
  const sales = direction === "SALES";
  const entities = client.entities.filter((e) => scope.entityIds.includes(e.id));
  const [view, accounts] = await Promise.all([
    receivablesView(prisma, client.id, direction, period.end, entities),
    prisma.account.findMany({ where: { clientId: client.id }, orderBy: { code: "asc" } }),
  ]);
  const label = formatPeriod(period.year, period.month);
  const word = sales ? "piutang" : "utang";
  const mismatch = view.comparison.filter((c) => !c.equal);
  const overdue = view.aging.flatMap((a) => (BigInt(a.totals.OVER_90) > 0n ? [`${a.entity} ${formatMoney(BigInt(a.totals.OVER_90), a.currency)}`] : []));
  const pick = (f: (a: (typeof accounts)[number]) => boolean) => accounts.filter(f).map((a) => ({ code: a.code, name: a.name }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Piutang & Utang"
        description={`${client.name} · daftar ${sales ? "faktur penjualan" : "tagihan pembelian"}, pelunasan dari rekening koran dan umur ${word} per ${label}`}
        actions={<ScopeBar entities={entityOptions} periods={periodOptions} entity={scope.value} period={period.key} />}
      />
      {view.unsettled.length ? (
        <NextStep>Cocokkan {view.unsettled.length} {sales ? "penerimaan" : "pembayaran"} di akun {word} ke {sales ? "fakturnya" : "tagihannya"}: buka {sales ? "faktur" : "tagihan"} lalu pilih Cocokkan.</NextStep>
      ) : mismatch.length ? (
        <NextStep>Daftar {word} {mismatch.map((c) => c.entity).join(", ")} berbeda dengan buku besar. Catat {sales ? "faktur" : "tagihan"} yang belum ada, termasuk rincian saldo awal.</NextStep>
      ) : view.invoices.length ? (
        <NextStep tone="done">Daftar {word} per {label} cocok dengan buku besar{overdue.length ? `; lewat 90 hari: ${overdue.join(", ")}` : ""}.</NextStep>
      ) : (
        <NextStep>Catat {sales ? "faktur penjualan" : "tagihan pembelian"} klien, atau rincian {word} yang sudah ada di Saldo Awal.</NextStep>
      )}
      <Receivables
        clientId={client.id}
        direction={direction}
        entities={[...entities].sort((a, b) => Number(a.kind === "PERORANGAN") - Number(b.kind === "PERORANGAN")).map((e) => ({ id: e.id, name: e.name, currency: e.functionalCurrency }))}
        {...view}
        accounts={{
          counter: pick((a) => !a.isBank && !a.isSuspense && !a.isClearing && !a.isIntercompany && (sales ? a.type === "PENDAPATAN" : (a.type === "BEBAN" || a.type === "ASET") && a.fsLine !== "PIUTANG_USAHA" && a.taxTag === null)),
          arAp: pick((a) => a.fsLine === (sales ? "PIUTANG_USAHA" : "UTANG_USAHA") && a.normalBalance === (sales ? "DEBIT" : "CREDIT")),
        }}
        defaultDate={toIsoDate(period.end)}
      />
    </div>
  );
}
