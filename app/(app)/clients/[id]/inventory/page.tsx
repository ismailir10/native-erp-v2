import { prisma } from "@/lib/db";
import { loadClientPage } from "@/lib/client-page";
import type { SearchParams } from "@/lib/scope";
import { formatDateTime, formatPeriod } from "@/lib/format";
import { ScopeBar } from "@/components/app/scope-bar";
import { NextStep, PageHeader } from "@/components/app/page-header";
import { InventoryCard, type InventoryEntityView } from "@/components/app/inventory-card";
import { inventoryRows } from "@/lib/inventory";

export default async function InventoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { client, period, scope, periodOptions, entityOptions, base } = await loadClientPage(params, searchParams);
  const [rows, p] = await Promise.all([
    inventoryRows(prisma, client.id, period.year, period.month, scope.entityIds),
    prisma.period.findUnique({ where: { clientId_year_month: { clientId: client.id, year: period.year, month: period.month } }, select: { status: true } }),
  ]);
  const label = formatPeriod(period.year, period.month);
  const locked = p?.status === "LOCKED";
  const shown = rows.filter((r) => r.applies);
  const others = rows.filter((r) => !r.applies);
  const open = shown.filter((r) => !r.count || r.count.amount !== r.book);
  const views: InventoryEntityView[] = (shown.length ? shown : rows).map((r) => ({
    entityId: r.entityId,
    entity: r.entity,
    currency: r.currency,
    book: r.book.toString(),
    purchasesMonth: r.purchasesMonth.toString(),
    count: r.count ? { amount: r.count.amount.toString(), note: r.count.note, by: r.count.by, at: formatDateTime(r.count.at), journaled: !!r.count.entryId } : null,
    previous: r.previous ? formatPeriod(r.previous.year, r.previous.month) : null,
    later: r.later ? formatPeriod(r.later.year, r.later.month) : null,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Persediaan"
        description={`${client.name} · stock opname akhir bulan dan beban pokok penjualan (metode periodik) per ${label}`}
        actions={<ScopeBar entities={entityOptions} periods={periodOptions} entity={scope.value} period={period.key} />}
      />
      {locked ? (
        <NextStep>{label} sudah ditutup. Hitungan persediaan bulan ini terkunci bersama bukunya.</NextStep>
      ) : !shown.length ? (
        <NextStep>Belum ada persediaan di buku klien ini. Isi nilai stock opname di bawah bila klien menyimpan barang dagangan atau bahan.</NextStep>
      ) : open.length ? (
        <NextStep>Isi hasil stock opname {label} untuk {open.map((r) => r.entity).join(", ")}. Bila klien hanya menghitung di akhir tahun, beri catatan di Tutup Buku.</NextStep>
      ) : (
        <NextStep tone="done" href={`${base}/reports?period=${period.key}`} cta="Lihat Laba Rugi">Persediaan akhir {label} sesuai hitungan; beban pokok penjualan sudah memperhitungkannya.</NextStep>
      )}
      <InventoryCard clientId={client.id} year={period.year} month={period.month} periodLabel={label} rows={views} locked={locked} />
      {shown.length > 0 && others.length > 0 && <p className="text-sm text-muted-foreground">Tanpa persediaan: {others.map((r) => r.entity).join(", ")}.</p>}
    </div>
  );
}
