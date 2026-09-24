import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { loadClientPage } from "@/lib/client-page";
import { type SearchParams, withParams } from "@/lib/scope";
import { formatDate, formatPeriod } from "@/lib/format";
import { PageHeader } from "@/components/app/page-header";
import { ScopeBar } from "@/components/app/scope-bar";
import { LedgerTable, type LedgerRow } from "@/components/app/ledger-table";
import { Card, CardContent } from "@/components/ui/card";
import { NextStep } from "@/components/app/page-header";
import { currencyNote } from "@/components/app/fx-missing";
import { formatMoney } from "@/lib/money";
import { formatRateId } from "@/lib/fx/currency";

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
        <NextStep>Baris buku besar ditampilkan per entitas karena mata uangnya berbeda. Pilih entitas:</NextStep>
        <ul className="flex flex-wrap gap-2">
          {scoped.map((e) => (
            <li key={e.id}>
              <Link className="rounded-md border bg-card px-3 py-1.5 text-sm hover:border-primary hover:text-primary" href={withParams(`${base}/ledger/${code}`, { period: period.key, entity: e.id })}>
                {e.shortName} · {e.functionalCurrency}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const isPL = account.type === "PENDAPATAN" || account.type === "BEBAN";
  const from = isPL ? new Date(Date.UTC(period.year, 0, 1)) : undefined;
  const before = await prisma.journalLine.aggregate({
    where: { accountId: account.id, entityId: { in: scope.entityIds }, date: { lt: period.start, gte: from } },
    _sum: { debit: true, credit: true },
  });
  const lines = await prisma.journalLine.findMany({
    where: { accountId: account.id, entityId: { in: scope.entityIds }, date: { gte: period.start, lte: period.end } },
    include: {
      entry: {
        include: {
          entity: true,
          lines: { include: { account: true } },
          bankTransaction: { include: { import: true, bankAccount: true } },
          ledgerImport: { select: { fileName: true } },
        },
      },
      sourceAccount: { select: { code: true, name: true } },
    },
    orderBy: [{ date: "asc" }, { entry: { createdAt: "asc" } }],
  });
  const sign = account.normalBalance === "DEBIT" ? 1n : -1n;
  const opening = ((before._sum.debit ?? 0n) - (before._sum.credit ?? 0n)) * sign;
  const balances = lines.reduce<bigint[]>((acc, l) => [...acc, (acc.at(-1) ?? opening) + (l.debit - l.credit) * sign], []);
  const rows: LedgerRow[] = lines.map((l, idx) => {
    const t = l.entry.bankTransaction;
    return {
      id: l.id,
      date: formatDate(l.date),
      entity: l.entry.entity.shortName,
      memo: l.entry.memo,
      kind: l.entry.kind,
      debit: l.debit.toString(),
      credit: l.credit.toString(),
      balance: balances[idx].toString(),
      entry: { lines: l.entry.lines.map((x) => ({ code: x.account.code, name: x.account.name, debit: x.debit.toString(), credit: x.credit.toString() })) },
      source: t
        ? { fileName: t.import.fileName, rowNumber: t.rowNumber, rawRow: t.rawRow, description: t.description, amount: t.amount.toString(), bank: `${t.bankAccount.label} · ${t.bankAccount.number}`, method: t.method, reason: t.reason, status: t.status }
        : null,
      fileSource: l.entry.ledgerImport
        ? {
            fileName: l.entry.ledgerImport.fileName,
            entryRef: l.entry.sourceRef ?? "",
            lineRef: l.sourceRef,
            sourceAccount: l.sourceAccount ? `${l.sourceAccount.code} ${l.sourceAccount.name}` : null,
            lineMemo: l.memo,
            fx: l.currency && l.fxAmount !== null && l.fxRate ? `${formatMoney(l.fxAmount, l.currency)} × kurs ${formatRateId(l.fxRate)}` : null,
          }
        : null,
    };
  });
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
