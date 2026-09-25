import Link from "next/link";
import { prisma } from "@/lib/db";
import { loadClientPage } from "@/lib/client-page";
import { type SearchParams, withParams } from "@/lib/scope";
import { trialBalance } from "@/lib/reports/ledger";
import { formatPeriod } from "@/lib/format";
import { NextStep, PageHeader } from "@/components/app/page-header";
import { ScopeBar } from "@/components/app/scope-bar";
import { Money } from "@/components/app/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { currencyNote, FxMissing, withFx } from "@/components/app/fx-missing";
import { FxMissingError } from "@/lib/reports/fx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const TYPES = [
  ["ASET", "Aset"],
  ["LIABILITAS", "Liabilitas"],
  ["EKUITAS", "Ekuitas"],
  ["PENDAPATAN", "Pendapatan"],
  ["BEBAN", "Beban"],
] as const;

export default async function LedgerIndex({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { client, period, scope, periodOptions, entityOptions, base, scopeLabel, currency, mixed } = await loadClientPage(params, searchParams);
  const note = currencyNote(currency, mixed);
  const header = <PageHeader title="Buku Besar" description={`${scopeLabel} · saldo per ${formatPeriod(period.year, period.month)}${note ? ` · ${note}` : ""}`} actions={<ScopeBar entities={entityOptions} periods={periodOptions} entity={scope.value} period={period.key} />} />;
  const tb = await withFx(() => trialBalance(prisma, { clientId: client.id, entityIds: scope.entityIds }, period.end));
  if (tb instanceof FxMissingError) return <div className="space-y-6">{header}<FxMissing error={tb} base={base} /></div>;
  const counts = await prisma.journalLine.groupBy({ by: ["accountId"], where: { entityId: { in: scope.entityIds }, date: { gte: period.start, lte: period.end } }, _count: true });
  const countMap = new Map(counts.map((c) => [c.accountId, c._count]));
  const q = { period: period.key, entity: scope.value };
  return (
    <div className="space-y-6">
      {header}
      <NextStep>Pilih akun untuk melihat mutasinya dan menelusuri ke baris rekening koran atau file sumber.</NextStep>
      {!tb.some((r) => r.net !== 0n || countMap.get(r.account.id)) && <p className="text-sm text-muted-foreground">Belum ada jurnal sampai {formatPeriod(period.year, period.month)}. Impor rekening koran atau buku besar untuk mengisi buku besar.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {TYPES.map(([t, label]) => {
          const rows = tb.filter((r) => r.account.type === t && (r.net !== 0n || countMap.get(r.account.id)));
          if (!rows.length) return null;
          const sign = t === "ASET" || t === "BEBAN" ? 1n : -1n;
          return (
            <Card key={t}>
              <CardHeader><CardTitle>{label}</CardTitle></CardHeader>
              <CardContent className="px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Akun</TableHead>
                      <TableHead className="text-right">Baris bln ini</TableHead>
                      <TableHead className="pr-6 text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.account.id}>
                        <TableCell className="pl-6">
                          <Link href={withParams(`${base}/ledger/${r.account.code}`, q)} className="underline decoration-border underline-offset-4 hover:text-primary hover:decoration-primary">
                            <span className="num text-muted-foreground">{r.account.code}</span> {r.account.name}
                          </Link>
                        </TableCell>
                        <TableCell className="num text-right text-muted-foreground">{countMap.get(r.account.id) ?? "–"}</TableCell>
                        <TableCell className="pr-6 text-right"><Money value={r.net * sign} currency={currency} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
