import { prisma } from "@/lib/db";
import { clientAccountsView, loadClientPage } from "@/lib/client-page";
import { clientAccountsByAccount, type ClientAccountPart } from "@/lib/reports/source";
import { type SearchParams, withParams } from "@/lib/scope";
import { balanceSheet, combinedWorksheet, incomeStatement, type BalanceSheet, type FsItem } from "@/lib/reports/ledger";
import { cashFlow, equityChanges, otherComprehensiveIncome } from "@/lib/reports/statements";
import { CashFlowTable, EquityTable, NotesView } from "@/components/app/statements";
import { financialNotes } from "@/lib/reports/notes";
import { formatPeriod, monthName } from "@/lib/format";
import { scopeFramework, statementNames } from "@/lib/reports/framework";
import { NextStep, PageHeader } from "@/components/app/page-header";
import { ScopeBar } from "@/components/app/scope-bar";
import { FsTable, type FsParts } from "@/components/app/fs-table";
import { Money } from "@/components/app/money";
import { StatusPill } from "@/components/app/status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UrlTabs } from "@/components/app/url-tabs";
import { currencyNote, FxMissing, withFx } from "@/components/app/fx-missing";
import { FxMissingError } from "@/lib/reports/fx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { Download } from "lucide-react";

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { client, period, scope, periodOptions, entityOptions, base, scopeLabel, sp, currency, mixed } = await loadClientPage(params, searchParams);
  const s = { clientId: client.id, entityIds: scope.entityIds };
  const yearStart = new Date(Date.UTC(period.year, 0, 1));
  const prevEnd = new Date(Date.UTC(period.year, period.month - 1, 0));
  const lastYearEnd = new Date(Date.UTC(period.year - 1, 11, 31));
  const priorFrom = new Date(Date.UTC(period.year - 1, 0, 1));
  const priorTo = new Date(Date.UTC(period.year - 1, period.month, 0));
  const multi = client.entities.length > 1;
  // Wording follows the entities' reporting framework (framework.ts): SAK EMKM has no other comprehensive income and no required cash flow.
  const framework = scopeFramework(client.entities.filter((e) => scope.entityIds.includes(e.id)));
  const names = statementNames(framework);
  const emkm = framework === "SAK_EMKM";
  const href = (code: string) => withParams(`${base}/ledger/${code}`, { period: period.key, entity: scope.value });
  const tab = typeof sp.tab === "string" ? sp.tab : "pl";
  const combinedNote = `Gabungan adalah pandangan manajemen, bukan konsolidasi menurut SAK (yang berlaku untuk induk–anak). Saldo antar entitas (1190) saling meniadakan bila kedua sisinya sudah tercatat; saldo 1190 yang masih tampil belum ada pasangannya di entitas lain.${
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
  // Client COA first: for one entity with its own accounts, each Buku account opens into the client accounts behind it.
  const view = await clientAccountsView(scope, sp);
  const q = { period: period.key, entity: scope.value };
  const partsOf = (map: Map<string, ClientAccountPart[]> | null, items: FsItem[]): FsParts | undefined => {
    if (!map) return undefined;
    const out: FsParts = {};
    for (const a of items.flatMap((i) => i.accounts)) {
      const list = map.get(a.code) ?? [];
      if (!list.some((x) => x.sourceAccountId) || a.amount === 0n) continue;
      const net = list.reduce((t, x) => t + x.net, 0n);
      const sign = net === 0n || (a.amount > 0n) === (net > 0n) ? 1n : -1n; // presentation sign of this FS line
      const rows = list.map((x) => ({ key: `${a.code}:${x.sourceAccountId ?? "-"}`, code: x.sourceAccountId ? x.code : "", name: x.name, amount: x.net * sign, href: x.sourceAccountId ? withParams(`${base}/ledger/akun/${x.sourceAccountId}`, q) : undefined }));
      const rest = a.amount - net * sign;
      if (rest !== 0n) rows.push({ key: `${a.code}:rest`, code: "", name: a.code === "3200" ? "Laba (rugi) tahun-tahun sebelumnya" : "Lainnya", amount: rest, href: a.code === "3200" ? withParams(`${base}/reports`, { period: `${period.year - 1}-12`, entity: scope.value, tab: "pl" }) : undefined });
      out[a.code] = rows;
    }
    return out;
  };
  const [bsParts, plParts] = view.available
    ? await Promise.all([clientAccountsByAccount(prisma, scope.value, { to: period.end }), clientAccountsByAccount(prisma, scope.value, { from: period.start, to: period.end })])
    : [null, null];
  const plItems = [...isMonth.revenue, ...isMonth.cogs, ...isMonth.opex, ...isMonth.other, ...isMonth.tax];
  const bsItems = [...bs.currentAssets, ...bs.nonCurrentAssets, ...bs.liabilities, ...bs.equity];
  // Comparison columns may lack a closing rate; the current period must not be blocked by them. Last month, and 31 December last year
  // (one column when they are the same date).
  const compare = async (d: Date) => {
    const r = await withFx(() => balanceSheet(prisma, s, d));
    return { label: formatPeriod(d.getUTCFullYear(), d.getUTCMonth() + 1), bs: r instanceof FxMissingError ? null : r };
  };
  const comparisons = +prevEnd === +lastYearEnd ? [await compare(prevEnd)] : [await compare(prevEnd), await compare(lastYearEnd)];
  const shown = comparisons.filter((c): c is { label: string; bs: BalanceSheet } => c.bs !== null);
  const missingLabels = comparisons.filter((c) => !c.bs).map((c) => c.label);
  const cmp = <T,>(cur: T, pick: (b: BalanceSheet) => T): T[] => [cur, ...shown.map((c) => pick(c.bs))];
  // Laba Rugi: the same months of last year, and other comprehensive income (single-currency scopes).
  const prior = await withFx(() => incomeStatement(prisma, s, priorFrom, priorTo));
  const isPrior = prior instanceof FxMissingError ? null : prior;
  const plCols = <T,>(month: T, ytd: T, old: T | undefined): T[] => (isPrior ? [month, ytd, old as T] : [month, ytd]);
  const [ociMonth, ociYtd, ociPrior] = mixed ? [null, null, null] : await Promise.all([otherComprehensiveIncome(prisma, s, period.start, period.end), otherComprehensiveIncome(prisma, s, yearStart, period.end), otherComprehensiveIncome(prisma, s, priorFrom, priorTo)]);
  const hasOci = !emkm && !!ociMonth && [ociMonth, ociYtd, ociPrior].some((o) => o && o.items.length);
  const [equity, cash, notes] = mixed ? [null, null, null] : await Promise.all([equityChanges(prisma, s, period.end), cashFlow(prisma, s, period.end), financialNotes(prisma, s, period.year, period.month)]);
  const wsCurrency = ws?.translated ? "IDR" : (client.entities[0]?.functionalCurrency ?? "IDR");

  return (
    <div className="space-y-6">
      {header}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <NextStep>Pilih nama akun untuk menelusuri buku besar sampai baris sumbernya.</NextStep>
        <a href={withParams(`${base}/reports/export`, { period: period.key, entity: scope.value })} className={buttonVariants({ variant: "outline", size: "sm" })} download data-testid="fs-download">
          <Download /> Unduh laporan keuangan (Excel)
        </a>
      </div>
      {scope.mode === "combined" && <p className="text-sm text-muted-foreground">{combinedNote}</p>}
      <UrlTabs defaultValue={tab}>
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="pl">Laba Rugi</TabsTrigger>
          <TabsTrigger value="bs">Neraca</TabsTrigger>
          <TabsTrigger value="eq">Perubahan Ekuitas</TabsTrigger>
          <TabsTrigger value="cf">Arus Kas</TabsTrigger>
          <TabsTrigger value="notes">CALK</TabsTrigger>
          {multi && <TabsTrigger value="ws">Kertas Kerja Gabungan</TabsTrigger>}
        </TabsList>

        <TabsContent value="pl">
          <Card>
            <CardHeader>
              <CardTitle>{emkm ? names.income : "Laporan Laba Rugi"}</CardTitle>
              <CardDescription>{monthName(period.month)} {period.year} dan 1 Januari – akhir {formatPeriod(period.year, period.month)}{isPrior ? `, dibandingkan periode yang sama tahun ${period.year - 1}` : ""}</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <FsTable
                accountHref={href}
                currency={currency}
                parts={partsOf(plParts, plItems)}
                columns={plCols(formatPeriod(period.year, period.month), `S.d. ${monthName(period.month)} ${period.year}`, `S.d. ${monthName(period.month)} ${period.year - 1}`)}
                sections={[
                  { items: plCols(isMonth.revenue, isYtd.revenue, isPrior?.revenue), total: { label: "Total pendapatan usaha", values: plCols(isMonth.totals.revenue, isYtd.totals.revenue, isPrior?.totals.revenue) } },
                  { items: plCols(isMonth.cogs, isYtd.cogs, isPrior?.cogs), total: { label: "Laba kotor", values: plCols(isMonth.totals.grossProfit, isYtd.totals.grossProfit, isPrior?.totals.grossProfit), strong: true } },
                  { title: "Beban operasional", items: plCols(isMonth.opex, isYtd.opex, isPrior?.opex), total: { label: "Laba usaha", values: plCols(isMonth.totals.operatingProfit, isYtd.totals.operatingProfit, isPrior?.totals.operatingProfit), strong: true } },
                  { title: "Pendapatan (beban) lain-lain", items: plCols(isMonth.other, isYtd.other, isPrior?.other), total: { label: "Laba sebelum pajak", values: plCols(isMonth.totals.profitBeforeTax, isYtd.totals.profitBeforeTax, isPrior?.totals.profitBeforeTax) } },
                  { items: plCols(isMonth.tax, isYtd.tax, isPrior?.tax), total: { label: "Laba bersih", values: plCols(isMonth.totals.netProfit, isYtd.totals.netProfit, isPrior?.totals.netProfit), strong: true } },
                  ...(hasOci
                    ? [{ title: "Penghasilan komprehensif lain", items: plCols(ociMonth!.items, ociYtd!.items, ociPrior?.items), total: { label: "Total penghasilan komprehensif", values: plCols(isMonth.totals.netProfit + ociMonth!.total, isYtd.totals.netProfit + ociYtd!.total, isPrior ? isPrior.totals.netProfit + ociPrior!.total : undefined), strong: true } }]
                    : []),
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
                {shown.length ? `, dibandingkan ${shown.map((c) => c.label).join(" dan ")}` : ""}
                {missingLabels.length ? `. Pembanding ${missingLabels.join(" dan ")}: isi kurs penutup bulan itu di halaman Kurs.` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <FsTable
                accountHref={href}
                currency={currency}
                parts={partsOf(bsParts, bsItems)}
                columns={[formatPeriod(period.year, period.month), ...shown.map((c) => c.label)]}
                sections={[
                  { title: "Aset lancar", items: cmp(bs.currentAssets, (b) => b.currentAssets) },
                  { title: "Aset tidak lancar", items: cmp(bs.nonCurrentAssets, (b) => b.nonCurrentAssets), total: { label: "Total aset", values: cmp(bs.totals.assets, (b) => b.totals.assets), strong: true } },
                  { title: "Liabilitas jangka pendek", items: cmp(bs.currentLiabilities, (b) => b.currentLiabilities) },
                  { title: "Liabilitas jangka panjang", items: cmp(bs.nonCurrentLiabilities, (b) => b.nonCurrentLiabilities), total: { label: "Total liabilitas", values: cmp(bs.totals.liabilities, (b) => b.totals.liabilities) } },
                  { title: "Ekuitas", items: cmp(bs.equity, (b) => b.equity), total: { label: "Total liabilitas & ekuitas", values: cmp(bs.totals.liabilities + bs.totals.equity, (b) => b.totals.liabilities + b.totals.equity), strong: true } },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="eq">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {names.equity}
                {equity && <StatusPill status={equity.totals.closing === equity.balanceSheetEquity ? "PASS" : "FAIL"} label={equity.totals.closing === equity.balanceSheetEquity ? "Sama dengan Neraca" : "Beda dengan Neraca"} />}
              </CardTitle>
              <CardDescription>1 Januari – akhir {formatPeriod(period.year, period.month)}</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {equity ? <EquityTable data={equity} currency={currency} accountHref={href} /> : <p className="px-6 text-sm text-muted-foreground">Laporan ini hanya untuk cakupan satu mata uang.</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cf">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {emkm ? "Laporan Arus Kas (informasi tambahan)" : "Laporan Arus Kas"}
                {cash && <StatusPill status={cash.openingCash + cash.net === cash.closingCash ? "PASS" : "FAIL"} label={cash.openingCash + cash.net === cash.closingCash ? "Sama dengan kas di Neraca" : "Beda dengan kas di Neraca"} />}
              </CardTitle>
              <CardDescription>Metode tidak langsung, dari perubahan pos neraca · 1 Januari – akhir {formatPeriod(period.year, period.month)}</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {cash ? <CashFlowTable data={cash} currency={currency} accountHref={href} /> : <p className="px-6 text-sm text-muted-foreground">Laporan ini hanya untuk cakupan satu mata uang.</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notes">
          <Card>
            <CardHeader>
              <CardTitle>Catatan atas Laporan Keuangan</CardTitle>
              <CardDescription>Draf dari angka laporan dan daftar-daftar di Buku, per akhir {formatPeriod(period.year, period.month)} dengan pembanding. Sunting di file unduhan.</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {mixed ? <p className="px-6 text-sm text-muted-foreground">CALK hanya untuk cakupan satu mata uang.</p> : notes && <NotesView data={notes} currency={currency} accountHref={href} />}
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
      </UrlTabs>
    </div>
  );
}
