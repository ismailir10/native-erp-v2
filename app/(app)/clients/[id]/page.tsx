import Link from "next/link";
import { prisma } from "@/lib/db";
import { loadClientPage } from "@/lib/client-page";
import { type SearchParams, withParams } from "@/lib/scope";
import { incomeStatement, monthlySeries } from "@/lib/reports/ledger";
import { taxSummary } from "@/lib/reports/tax";
import { runControls } from "@/lib/controls";
import { automationByMonth } from "@/lib/queries";
import { formatMonthShort, formatPeriod } from "@/lib/format";
import { formatMoneyCompact } from "@/lib/money";
import { FxMissing, withFx } from "@/components/app/fx-missing";
import { FxMissingError } from "@/lib/reports/fx";
import { NextStep, PageHeader, Stat } from "@/components/app/page-header";
import { ScopeBar } from "@/components/app/scope-bar";
import { StatusPill } from "@/components/app/status";
import { Money } from "@/components/app/money";
import { AutomationChart, CashChart, RevenueExpenseChart } from "@/components/app/charts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowRight } from "lucide-react";

export default async function ClientOverview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { client, period, scope, periodOptions, entityOptions, base, scopeLabel, currency } = await loadClientPage(params, searchParams);
  const s = { clientId: client.id, entityIds: scope.entityIds };
  // A ledger import brings its own opening rows, so those entities don't need a separate Saldo Awal.
  const withOpening = new Set(
    (await prisma.journalEntry.findMany({ where: { entityId: { in: client.entities.map((e) => e.id) }, kind: { in: ["OPENING", "IMPORTED"] } }, select: { entityId: true }, distinct: ["entityId"] })).map((j) => j.entityId),
  );
  const noOpening = client.entities.filter((e) => !withOpening.has(e.id));
  // Indonesian tax estimates only make sense for Rupiah entities.
  const idrScope = { clientId: client.id, entityIds: client.entities.filter((e) => scope.entityIds.includes(e.id) && e.functionalCurrency === "IDR").map((e) => e.id) };
  const [figures, tax, controls, openReview, auto, periodRow] = await Promise.all([
    withFx(async () => ({ series: await monthlySeries(prisma, s, period.end, 6), is: await incomeStatement(prisma, s, period.start, period.end) })),
    taxSummary(prisma, idrScope, period.start, period.end),
    runControls(prisma, client.id, period.year, period.month),
    prisma.bankTransaction.count({ where: { entityId: { in: scope.entityIds }, status: "NEEDS_REVIEW" } }),
    automationByMonth([client.id]),
    prisma.period.findUnique({ where: { clientId_year_month: { clientId: client.id, year: period.year, month: period.month } } }),
  ]);
  const fxMissing = figures instanceof FxMissingError ? figures : null;
  const series = fxMissing ? [] : (figures as Exclude<typeof figures, FxMissingError>).series;
  const is = fxMissing ? null : (figures as Exclude<typeof figures, FxMissingError>).is;
  const money = (v: bigint) => formatMoneyCompact(v, currency);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const chartData = series.map((p) => ({ label: formatMonthShort(p.year, p.month), cash: Number(p.cash), revenue: Number(p.revenue), expense: Number(p.expense) }));
  const counts = { PASS: 0, REVIEW: 0, FAIL: 0 };
  for (const c of controls) counts[c.status]++;
  const missing = controls.filter((c) => c.key.startsWith("bank:") && c.detail.includes("belum diimpor"));
  const q = { period: period.key, entity: scope.value };
  const locked = periodRow?.status === "LOCKED";
  const hasPpn = tax.ppnKeluaran !== 0n || tax.ppnMasukan !== 0n;

  return (
    <div className="space-y-6">
      <PageHeader
        title={client.name}
        description={`${scopeLabel} · ${client.industry ?? ""}`}
        actions={<ScopeBar entities={entityOptions} periods={periodOptions} entity={scope.value} period={period.key} />}
      />

      {locked ? (
        <NextStep tone="done">Buku {formatPeriod(period.year, period.month)} sudah ditutup.</NextStep>
      ) : noOpening.length ? (
        <NextStep href={`${base}/opening`} cta="Isi saldo awal">
          Isi saldo awal {noOpening.map((e) => e.shortName).join(" dan ")} dulu, supaya saldo bank di buku cocok dengan rekening koran.
        </NextStep>
      ) : missing.length ? (
        <NextStep href={`${base}/import`} cta="Impor mutasi">
          Mutasi {missing.map((m) => m.title.replace("Rekonsiliasi ", "")).join(", ")} untuk {formatPeriod(period.year, period.month)} belum diimpor.
        </NextStep>
      ) : openReview ? (
        <NextStep href={`${base}/review`} cta="Review transaksi">
          {openReview} transaksi perlu dicek. Semuanya sudah punya usulan akun.
        </NextStep>
      ) : (
        <NextStep href={`${base}/close`} cta="Tutup buku">
          Semua transaksi sudah terklasifikasi. Cek kontrol lalu tutup buku.
        </NextStep>
      )}

      {fxMissing || !is ? (
        <FxMissing error={fxMissing!} base={base} compact />
      ) : (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label="Saldo kas & bank" value={money(last.cash)} hint={prev ? `${last.cash >= prev.cash ? "Naik" : "Turun"} ${money(last.cash >= prev.cash ? last.cash - prev.cash : prev.cash - last.cash)} dari bulan lalu` : undefined} />
        <Stat label={`Pendapatan ${formatPeriod(period.year, period.month)}`} value={money(is.totals.revenue)} hint="Tanpa PPN" />
        <Stat label="Laba bersih bulan ini" value={money(is.totals.netProfit)} hint={is.totals.revenue ? `Margin ${Math.round((Number(is.totals.netProfit) / Number(is.totals.revenue)) * 100)}%` : undefined} />
        <Stat label="Kontrol tutup buku" value={`${counts.PASS}/${controls.length}`} hint={counts.FAIL ? `${counts.FAIL} gagal` : counts.REVIEW ? `${counts.REVIEW} perlu dicek` : "Semua lolos"} />
      </div>
      )}

      {fxMissing ? null : auto.length === 0 && series.every((p) => p.cash === 0n && p.revenue === 0n && p.expense === 0n) ? (
        <Card>
          <CardHeader>
            <CardTitle>Belum ada mutasi</CardTitle>
            <CardDescription>Grafik kas, pendapatan dan beban muncul setelah rekening koran pertama diimpor.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Saldo kas & bank</CardTitle>
              <CardDescription>Akhir bulan, 6 bulan terakhir</CardDescription>
            </CardHeader>
            <CardContent>
              <CashChart data={chartData} currency={currency} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Pendapatan vs beban</CardTitle>
              <CardDescription>Per bulan, dari buku besar</CardDescription>
            </CardHeader>
            <CardContent>
              <RevenueExpenseChart data={chartData} currency={currency} />
              <Table className="mt-2 text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-7" />
                    {chartData.map((p) => (
                      <TableHead key={p.label} className="h-7 text-right">{p.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(["revenue", "expense"] as const).map((k) => (
                    <TableRow key={k}>
                      <TableCell className="py-1 text-muted-foreground">{k === "revenue" ? "Pendapatan" : "Beban"}</TableCell>
                      {series.map((p) => (
                        <TableCell key={`${p.month}`} className="num py-1 text-right">{money(p[k]).replace(/^\S+ /, "")}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Kontrol {formatPeriod(period.year, period.month)}</CardTitle>
            <CardDescription>
              <Link className="inline-flex items-center gap-1 text-primary hover:underline" href={withParams(`${base}/close`, { period: period.key })}>Buka Tutup Buku <ArrowRight className="size-3.5" /></Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {controls.filter((c) => c.status !== "PASS").slice(0, 5).map((c) => (
              <div key={c.key} className="flex items-start justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <div className="break-words font-medium">{c.title}</div>
                  <div className="break-words text-xs text-muted-foreground">{c.scope} · {c.detail}</div>
                </div>
                <StatusPill status={c.status} className="shrink-0" />
              </div>
            ))}
            {counts.REVIEW + counts.FAIL === 0 && <div className="text-sm text-muted-foreground">Semua {controls.length} kontrol lolos.</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pajak bulan ini</CardTitle>
            <CardDescription>Estimasi dari mutasi bank, bukan SPT</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {!hasPpn && tax.pph42 === 0n && tax.pph21 === 0n ? (
              <p className="text-muted-foreground">Tidak ada transaksi pajak terdeteksi bulan ini.</p>
            ) : (
              <>
                {hasPpn && (
                  <>
                    <Row label="PPN Keluaran" value={tax.ppnKeluaran} />
                    <Row label="PPN Masukan" value={tax.ppnMasukan} />
                    <div className="flex justify-between border-t pt-1.5 font-medium">
                      <span>PPN {tax.ppnNet >= 0n ? "kurang bayar" : "lebih bayar"}</span>
                      <Money value={tax.ppnNet < 0n ? -tax.ppnNet : tax.ppnNet} strong />
                    </div>
                  </>
                )}
                {tax.pph42 !== 0n && <Row label="PPh 4(2) final atas bunga" value={tax.pph42} className={hasPpn ? "pt-2" : ""} />}
                {tax.pph21 !== 0n && <Row label="PPh 21 disetor" value={tax.pph21} />}
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Dikode otomatis</CardTitle>
            <CardDescription>% mutasi tanpa review manual, per bulan</CardDescription>
          </CardHeader>
          <CardContent>
            {auto.length ? (
              <AutomationChart data={auto.map((a) => ({ label: formatMonthShort(Number(a.ym.slice(0, 4)), Number(a.ym.slice(5))), pct: a.pct }))} />
            ) : (
              <p className="text-sm text-muted-foreground">Belum ada mutasi yang dikode.</p>
            )}
          </CardContent>
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">
        Laporan disusun dari mutasi bank (basis kas) + jurnal penyesuaian. <Link className="text-primary hover:underline" href={withParams(`${base}/reports`, q)}>Lihat laporan keuangan <ArrowRight className="inline size-3" /></Link>
      </p>
    </div>
  );
}

function Row({ label, value, className }: { label: string; value: bigint; className?: string }) {
  return (
    <div className={`flex justify-between ${className ?? ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <Money value={value} />
    </div>
  );
}
