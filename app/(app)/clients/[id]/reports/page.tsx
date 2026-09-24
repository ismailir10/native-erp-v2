import { prisma } from "@/lib/db";
import { loadClientPage } from "@/lib/client-page";
import { type SearchParams, withParams } from "@/lib/scope";
import { balanceSheet, combinedWorksheet, incomeStatement } from "@/lib/reports/ledger";
import { formatPeriod, monthName } from "@/lib/format";
import { PageHeader } from "@/components/app/page-header";
import { ScopeBar } from "@/components/app/scope-bar";
import { FsTable } from "@/components/app/fs-table";
import { Money } from "@/components/app/money";
import { StatusPill } from "@/components/app/status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { client, period, scope, periodOptions, entityOptions, base, scopeLabel, sp } = await loadClientPage(params, searchParams);
  const s = { clientId: client.id, entityIds: scope.entityIds };
  const yearStart = new Date(Date.UTC(period.year, 0, 1));
  const prevEnd = new Date(Date.UTC(period.year, period.month - 1, 0));
  const [isMonth, isYtd, bs, bsPrev] = await Promise.all([
    incomeStatement(prisma, s, period.start, period.end),
    incomeStatement(prisma, s, yearStart, period.end),
    balanceSheet(prisma, s, period.end),
    balanceSheet(prisma, s, prevEnd),
  ]);
  const multi = client.entities.length > 1;
  const ws = multi ? await combinedWorksheet(prisma, client.id, period.end) : null;
  const href = (code: string) => withParams(`${base}/ledger/${code}`, { period: period.key, entity: scope.value });
  const tab = typeof sp.tab === "string" ? sp.tab : "pl";
  const combinedNote = "Gabungan PT dan pemilik perorangan adalah pandangan manajemen, bukan konsolidasi menurut SAK (yang berlaku untuk induk–anak). Saldo antar entitas (1190) dieliminasi.";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Laporan Keuangan"
        description={
          <span className="inline-flex items-center gap-1">
            {scopeLabel} · basis kas + penyesuaian
            {scope.mode === "combined" && (
              <Tooltip>
                <TooltipTrigger render={<button type="button" aria-label="Tentang gabungan" className="text-muted-foreground hover:text-foreground" />}>
                  <Info className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{combinedNote}</TooltipContent>
              </Tooltip>
            )}
          </span>
        }
        actions={<ScopeBar entities={entityOptions} periods={periodOptions} entity={scope.value} period={period.key} />}
      />
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
              <CardDescription>Per akhir {formatPeriod(period.year, period.month)}, dibandingkan bulan sebelumnya</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <FsTable
                accountHref={href}
                columns={[formatPeriod(period.year, period.month), formatPeriod(prevEnd.getUTCFullYear(), prevEnd.getUTCMonth() + 1)]}
                sections={[
                  { title: "Aset lancar", items: [bs.currentAssets, bsPrev.currentAssets] },
                  { title: "Aset tidak lancar", items: [bs.nonCurrentAssets, bsPrev.nonCurrentAssets], total: { label: "Total aset", values: [bs.totals.assets, bsPrev.totals.assets], strong: true } },
                  { title: "Liabilitas", items: [bs.liabilities, bsPrev.liabilities], total: { label: "Total liabilitas", values: [bs.totals.liabilities, bsPrev.totals.liabilities] } },
                  { title: "Ekuitas", items: [bs.equity, bsPrev.equity], total: { label: "Total liabilitas & ekuitas", values: [bs.totals.liabilities + bs.totals.equity, bsPrev.totals.liabilities + bsPrev.totals.equity], strong: true } },
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
                <CardDescription>{combinedNote} Saldo debit (+) / kredit (−).</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto px-0">
                <table className="w-full text-sm" data-testid="worksheet">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="py-2 pl-6 text-left font-medium">Akun</th>
                      {ws.entities.map((e) => <th key={e.id} className="py-2 pr-4 text-right font-medium">{e.shortName}</th>)}
                      <th className="py-2 pr-4 text-right font-medium">Eliminasi</th>
                      <th className="py-2 pr-6 text-right font-medium">Gabungan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ws.rows.map((r) => (
                      <tr key={r.key} className={r.elimination !== 0n ? "bg-primary-subtle/60" : "border-t border-border/60"}>
                        <td className="py-1.5 pl-6"><span className="num text-muted-foreground">{r.code}</span> {r.name}</td>
                        {r.values.map((v, i) => <td key={i} className="py-1.5 pr-4 text-right"><Money value={v} /></td>)}
                        <td className="py-1.5 pr-4 text-right font-medium text-primary"><Money value={r.elimination} /></td>
                        <td className="py-1.5 pr-6 text-right font-medium"><Money value={r.combined} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {ws.residual !== 0n && (
                  <p className="px-6 pt-3 text-sm text-review">
                    Selisih <Money value={ws.residual} /> — biasanya karena mutasi salah satu entitas belum diimpor.
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
