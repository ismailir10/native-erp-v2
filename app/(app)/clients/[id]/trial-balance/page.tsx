import Link from "next/link";
import { prisma } from "@/lib/db";
import { loadClientPage } from "@/lib/client-page";
import { type SearchParams, withParams } from "@/lib/scope";
import { trialBalance } from "@/lib/reports/ledger";
import { formatPeriod } from "@/lib/format";
import { PageHeader } from "@/components/app/page-header";
import { ScopeBar } from "@/components/app/scope-bar";
import { Money } from "@/components/app/money";
import { StatusPill } from "@/components/app/status";
import { Card, CardContent } from "@/components/ui/card";
import { currencyNote, FxMissing, withFx } from "@/components/app/fx-missing";
import { FxMissingError } from "@/lib/reports/fx";
import { sourceTrialBalance } from "@/lib/reports/source";
import { NextStep } from "@/components/app/page-header";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default async function TrialBalancePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { client, period, scope, periodOptions, entityOptions, base, scopeLabel, currency, mixed, sp } = await loadClientPage(params, searchParams);
  const note = currencyNote(currency, mixed);
  const view = sp.view === "source" ? "source" : "client";
  const hasSources = (await prisma.sourceAccount.count({ where: { clientId: client.id } })) > 0;
  const header = (
    <>
      <PageHeader
        title="Neraca Saldo"
        description={`${scopeLabel} · per akhir ${formatPeriod(period.year, period.month)}${note ? ` · ${note}` : ""}`}
        actions={<ScopeBar entities={entityOptions} periods={periodOptions} entity={scope.value} period={period.key} />}
      />
      {hasSources && (
        <Tabs value={view}>
          <TabsList aria-label="Tampilan akun">
            {(["client", "source"] as const).map((v) => (
              <TabsTrigger key={v} value={v} nativeButton={false} render={<Link href={withParams(`${base}/trial-balance`, { period: period.key, entity: scope.value, view: v === "source" ? "source" : undefined })} />}>
                {v === "client" ? "Bagan akun Buku" : "Akun sumber"}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
    </>
  );
  if (view === "source") {
    if (scope.mode !== "entity") {
      return (
        <div className="space-y-6">
          {header}
          <NextStep>Akun sumber berbeda per entitas. Pilih satu entitas di atas.</NextStep>
        </div>
      );
    }
    const rows = await sourceTrialBalance(prisma, scope.value, period.end);
    const sdr = rows.reduce((s, r) => s + (r.net > 0n ? r.net : 0n), 0n);
    const scr = rows.reduce((s, r) => s + (r.net < 0n ? -r.net : 0n), 0n);
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32 pl-6">Kode di file</TableHead>
                  <TableHead>Akun di file</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="pr-6 text-right">Kredit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="num pl-6 text-muted-foreground">{r.code.replace(/^NC:.*/, "–")}</TableCell>
                    <TableCell>
                      {r.name}
                      {!r.isSource && r.code && <span className="ml-2 text-xs text-muted-foreground">(tanpa akun sumber)</span>}
                      {r.previousNames.length > 0 && <div className="text-xs text-muted-foreground">dulu: {r.previousNames.map((p) => `“${p}”`).join(", ")}</div>}
                      {r.clientAccount && (
                        <Link className="block text-xs text-muted-foreground underline decoration-border underline-offset-4 hover:text-primary hover:decoration-primary" href={withParams(`${base}/ledger/${r.clientAccount.code}`, { period: period.key, entity: scope.value })}>
                          → <span className="num">{r.clientAccount.code}</span> {r.clientAccount.name}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{r.net > 0n ? <Money value={r.net} currency={currency} /> : null}</TableCell>
                    <TableCell className="pr-6 text-right">{r.net < 0n ? <Money value={-r.net} currency={currency} /> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="pl-6" colSpan={2}>
                    <span className="mr-2 font-semibold">Total</span>
                    <StatusPill status={sdr === scr ? "PASS" : "FAIL"} label={sdr === scr ? "Seimbang" : "Tidak seimbang"} />
                  </TableCell>
                  <TableCell className="text-right"><Money value={sdr} strong currency={currency} /></TableCell>
                  <TableCell className="pr-6 text-right"><Money value={scr} strong currency={currency} /></TableCell>
                </TableRow>
              </TableFooter>
            </Table>
            {rows.length === 0 && <p className="px-6 py-8 text-center text-sm text-muted-foreground">Belum ada saldo untuk entitas ini per akhir periode.</p>}
          </CardContent>
        </Card>
      </div>
    );
  }
  const all = await withFx(() => trialBalance(prisma, { clientId: client.id, entityIds: scope.entityIds }, period.end));
  if (all instanceof FxMissingError) return <div className="space-y-6">{header}<FxMissing error={all} base={base} /></div>;
  const tb = all.filter((r) => r.net !== 0n);
  const dr = tb.reduce((s, r) => s + r.debit, 0n);
  const cr = tb.reduce((s, r) => s + r.credit, 0n);
  const q = { period: period.key, entity: scope.value };
  return (
    <div className="space-y-6">
      {header}
      {tb.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada saldo per akhir {formatPeriod(period.year, period.month)}. Impor rekening koran atau buku besar untuk mengisi neraca saldo.</p> : <NextStep>Debit dan kredit harus sama. Pilih nama akun untuk membuka buku besarnya.</NextStep>}
      <Card>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24 pl-6">Kode</TableHead>
                <TableHead>Akun</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="pr-6 text-right">Kredit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tb.map((r) => (
                <TableRow key={r.account.id}>
                  <TableCell className="num pl-6 text-muted-foreground">{r.account.code}</TableCell>
                  <TableCell>
                    <Link className="underline decoration-border underline-offset-4 hover:text-primary hover:decoration-primary" href={withParams(`${base}/ledger/${r.account.code}`, q)}>{r.account.name}</Link>
                    {r.account.isSuspense && <StatusPill className="ml-2" status="REVIEW" label="Perlu dicek" />}
                  </TableCell>
                  <TableCell className="pr-0 text-right">{r.debit ? <Money value={r.debit} currency={currency} /> : null}</TableCell>
                  <TableCell className="pr-6 text-right">{r.credit ? <Money value={r.credit} currency={currency} /> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="pl-6" colSpan={2}>
                  <span className="mr-2 font-semibold">Total</span>
                  <StatusPill status={dr === cr ? "PASS" : "FAIL"} label={dr === cr ? "Seimbang" : "Tidak seimbang"} />
                </TableCell>
                <TableCell className="text-right"><Money value={dr} strong currency={currency} /></TableCell>
                <TableCell className="pr-6 text-right"><Money value={cr} strong currency={currency} /></TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
