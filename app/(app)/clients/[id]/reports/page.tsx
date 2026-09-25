import { prisma } from "@/lib/db";
import { loadClientPage } from "@/lib/client-page";
import { type SearchParams, withParams } from "@/lib/scope";
import { balanceSheet, combinedWorksheet, incomeStatement } from "@/lib/reports/ledger";
import { formatPeriod, monthName } from "@/lib/format";
import { NextStep, PageHeader } from "@/components/app/page-header";
import { ScopeBar } from "@/components/app/scope-bar";
import { FsTable } from "@/components/app/fs-table";
import { Money } from "@/components/app/money";
import { StatusPill } from "@/components/app/status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { currencyNote, FxMissing, withFx } from "@/components/app/fx-missing";
import { FxMissingError } from "@/lib/reports/fx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { client, period, scope, periodOptions, entityOptions, base, scopeLabel, sp, currency, mixed } = await loadClientPage(params, searchParams);
  const s = { clientId: client.id, entityIds: scope.entityIds };
  const yearStart = new Date(Date.UTC(period.year, 0, 1));
  const prevEnd = new Date(Date.UTC(period.year, period.month - 1, 0));
  const multi = client.entities.length > 1;
  const href = (code: string) => withParams(`${base}/ledger/${code}`, { period: period.key, entity: scope.value });
  const tab = typeof sp.tab === "string" ? sp.tab : "pl";
  const combinedNote = `Gabungan adalah pandangan manajemen, bukan konsolidasi menurut SAK (yang berlaku untuk induk–anak). Saldo antar entitas (1190) dieliminasi.${
    mixed ? " Entitas non-Rupiah dijabarkan: aset & liabilitas dengan kurs penutup, laba rugi dengan kurs rata-rata, ekuitas dengan kurs historis; selisihnya di akun 3900." : ""
  }`;
  const note = currencyNote(currency, mixed);
  const header = (
    <PageHeader
      title="Laporan Keuangan"
      description={`${scopeLabel} · basis kas + penyesuaian${note ? ` · ${note}` : ""}`}
      actions={<ScopeBar entities={entityOptions} periods={periodOptions} entity={scope.value} period={period.key} />}
    />
  );
  const data = await withFx(async () => {
    const [isMonth, isYtd, bs] = await Promise.all([
      incomeStatement(prisma, s, period.start, period.end),
      incomeStatement(prisma, s, yearStart, period.end),
      balanceSheet(prisma, s, period.end),
    ]);
    const ws = multi ? await combinedWorksheet(prisma, client.id, period.end) : null;
    return { isMonth, isYtd, bs, ws };
  });
  if (data instanceof FxMissingError) {
    return (
      <div className="space-y-6">
        {header}
        <FxMissing error={data} base={base} />
      </div>
    );
  }
  const { isMonth, isYtd, bs, ws } = data;
  // The comparison column may lack last month's closing rate; the current period must not be blocked by it.
  const prev = await withFx(() => balanceSheet(prisma, s, prevEnd));
  const bsPrev = prev instanceof FxMissingError ? null : prev;
  const prevLabel = `${formatPeriod(prevEnd.getUTCFullYear(), prevEnd.getUTCMonth() + 1)}${bsPrev ? "" : " (belum dijabarkan)"}`;
  const cmp = <T,>(cur: T, old: T | undefined): T[] => (bsPrev ? [cur, old as T] : [cur]);
  const wsCurrency = ws?.translated ? "IDR" : (client.entities[0]?.functionalCurrency ?? "IDR");

  return (
    <div className="space-y-6">
      {header}
      <NextStep>Pilih nama akun untuk menelusuri buku besar sampai baris sumbernya.</NextStep>
      {scope.mode === "combined" && <p className="text-sm text-muted-foreground">{combinedNote}</p>}
      <Tabs defaultValue={tab}>
        <TabsList>
          <TabsTrigger value="pl">Laba Rugi</TabsTrigger>
          <TabsTrigger value="bs">Neraca</TabsTrigger>
          {multi && <TabsTrigger value="ws">Kertas Kerja Gabungan</TabsTrigger>}
        </TabsList>

        <TabsContent value="pl">
          <Card>
            <CardHeader>
              <CardTitle>Laporan Laba Rugi</CardTitle>
              <CardDescription>{monthName(period.month)} {period.year} dan 1 Januari – akhir {formatPeriod(period.year, period.month)}</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <FsTable
                accountHref={href}
                currency={currency}
                columns={[formatPeriod(period.year, period.month), `S.d. ${monthName(period.month)}`]}
                sections={[
                  { items: [isMonth.revenue, isYtd.revenue], total: { label: "Total pendapatan usaha", values: [isMonth.totals.revenue, isYtd.totals.revenue] } },
                  { items: [isMonth.cogs, isYtd.cogs], total: { label: "Laba kotor", values: [isMonth.totals.grossProfit, isYtd.totals.grossProfit], strong: true } },
                  { title: "Beban operasional", items: [isMonth.opex, isYtd.opex], total: { label: "Laba usaha", values: [isMonth.totals.operatingProfit, isYtd.totals.operatingProfit], strong: true } },
                  { title: "Pendapatan (beban) lain-lain", items: [isMonth.other, isYtd.other], total: { label: "Laba sebelum pajak", values: [isMonth.totals.profitBeforeTax, isYtd.totals.profitBeforeTax] } },
                  { items: [isMonth.tax, isYtd.tax], total: { label: "Laba bersih", values: [isMonth.totals.netProfit, isYtd.totals.netProfit], strong: true } },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bs">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Laporan Posisi Keuangan (Neraca)
                <StatusPill status={bs.totals.difference === 0n ? "PASS" : "FAIL"} label={bs.totals.difference === 0n ? "Seimbang" : `Selisih`} />
              </CardTitle>
              <CardDescription>
                Per akhir {formatPeriod(period.year, period.month)}
                {bsPrev ? ", dibandingkan bulan sebelumnya" : `. Pembanding ${prevLabel}: isi kurs penutup bulan itu di halaman Kurs.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <FsTable
                accountHref={href}
                currency={currency}
                columns={bsPrev ? [formatPeriod(period.year, period.month), prevLabel] : [formatPeriod(period.year, period.month)]}
                sections={[
                  { title: "Aset lancar", items: cmp(bs.currentAssets, bsPrev?.currentAssets) },
                  { title: "Aset tidak lancar", items: cmp(bs.nonCurrentAssets, bsPrev?.nonCurrentAssets), total: { label: "Total aset", values: cmp(bs.totals.assets, bsPrev?.totals.assets), strong: true } },
                  { title: "Liabilitas", items: cmp(bs.liabilities, bsPrev?.liabilities), total: { label: "Total liabilitas", values: cmp(bs.totals.liabilities, bsPrev?.totals.liabilities) } },
                  { title: "Ekuitas", items: cmp(bs.equity, bsPrev?.equity), total: { label: "Total liabilitas & ekuitas", values: cmp(bs.totals.liabilities + bs.totals.equity, bsPrev ? bsPrev.totals.liabilities + bsPrev.totals.equity : undefined), strong: true } },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {ws && (
          <TabsContent value="ws">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Kertas Kerja Gabungan
                  <StatusPill status={ws.residual === 0n ? "PASS" : "REVIEW"} label={ws.residual === 0n ? "Antar entitas cocok" : "Ada selisih antar entitas"} />
                </CardTitle>
                <CardDescription>{combinedNote} Saldo debit (+) / kredit (−){ws.translated ? ", semua kolom dalam Rupiah" : wsCurrency !== "IDR" ? `, dalam ${wsCurrency}` : ""}.</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto px-0">
                <Table data-testid="worksheet">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="py-2 pl-6 text-left font-medium">Akun</TableHead>
                      {ws.entities.map((e) => <TableHead key={e.id} className="py-2 pr-4 text-right font-medium">{e.shortName}</TableHead>)}
                      <TableHead className="py-2 pr-4 text-right font-medium">Eliminasi</TableHead>
                      <TableHead className="py-2 pr-6 text-right font-medium">Gabungan</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ws.rows.map((r) => (
                      <TableRow key={r.key} className={r.elimination !== 0n ? "bg-primary-subtle/60" : "border-t border-border/60"}>
                        <TableCell className="py-1.5 pl-6"><span className="num text-muted-foreground">{r.code}</span> {r.name}</TableCell>
                        {r.values.map((v, i) => <TableCell key={i} className="py-1.5 pr-4 text-right"><Money value={v} currency={wsCurrency} /></TableCell>)}
                        <TableCell className="py-1.5 pr-4 text-right font-medium text-primary"><Money value={r.elimination} currency={wsCurrency} /></TableCell>
                        <TableCell className="py-1.5 pr-6 text-right font-medium"><Money value={r.combined} currency={wsCurrency} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {ws.residual !== 0n && (
                  <p className="px-6 pt-3 text-sm text-review">
                    Selisih <Money value={ws.residual} currency={wsCurrency} />. Biasanya karena mutasi salah satu entitas belum diimpor.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
