import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { loadClientPage } from "@/lib/client-page";
import { type SearchParams, withParams } from "@/lib/scope";
import { formatPeriod } from "@/lib/format";
import { PageHeader } from "@/components/app/page-header";
import { ScopeBar } from "@/components/app/scope-bar";
import { LedgerTable } from "@/components/app/ledger-table";
import { accountLedger } from "@/lib/reports/account-ledger";
import { Card, CardContent } from "@/components/ui/card";
import { NextStep } from "@/components/app/page-header";
import { currencyNote } from "@/components/app/fx-missing";

export default async function AccountLedger({ params, searchParams }: { params: Promise<{ id: string; code: string }>; searchParams: SearchParams }) {
  const { code } = await params;
  const { client, period, scope, periodOptions, entityOptions, base, scopeLabel, currency, mixed } = await loadClientPage(params, searchParams);
  const account = await prisma.account.findUnique({ where: { clientId_code: { clientId: client.id, code } } });
  if (!account) notFound();
  const back = (
    <Link href={withParams(`${base}/ledger`, { period: period.key, entity: scope.value })} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ChevronLeft className="size-4" /> Buku Besar
    </Link>
  );
  if (mixed) {
    // One ledger can't list SGD and IDR lines in one running balance: show it per entity.
    const scoped = client.entities.filter((e) => scope.entityIds.includes(e.id));
    return (
      <div className="space-y-6">
        {back}
        <PageHeader title={`${account.code} ${account.name}`} description={`${scopeLabel} · ${formatPeriod(period.year, period.month)}`} actions={<ScopeBar entities={entityOptions} periods={periodOptions} entity={scope.value} period={period.key} />} />
        <NextStep>Buku besar ditampilkan per perusahaan karena mata uangnya berbeda. Pilih perusahaan.</NextStep>
        <ul className="flex flex-wrap gap-2">
          {scoped.map((e) => (
            <li key={e.id}>
              <Button variant="outline" render={<Link href={withParams(`${base}/ledger/${code}`, { period: period.key, entity: e.id })} />}>
                {e.shortName} · {e.functionalCurrency} <ChevronRight />
              </Button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const isPL = account.type === "PENDAPATAN" || account.type === "BEBAN";
  const { opening, rows } = await accountLedger(prisma, { accountId: account.id, entityIds: scope.entityIds, start: period.start, end: period.end, normalBalance: account.normalBalance, isPL });
  return (
    <div className="space-y-6">
      {back}
      <PageHeader
        title={`${account.code} ${account.name}`}
        description={`${scopeLabel} · ${formatPeriod(period.year, period.month)}${currencyNote(currency, false) ? ` · ${currencyNote(currency, false)}` : ""} · klik baris untuk melihat sumbernya`}
        actions={<ScopeBar entities={entityOptions} periods={periodOptions} entity={scope.value} period={period.key} />}
      />
      <Card>
        <CardContent className="px-0">
          <LedgerTable rows={rows} opening={opening.toString()} currency={currency} />
          {rows.length === 0 && <p className="px-6 py-8 text-center text-sm text-muted-foreground">Tidak ada transaksi di periode ini.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
