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
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function TrialBalancePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { client, period, scope, periodOptions, entityOptions, base, scopeLabel, currency, mixed } = await loadClientPage(params, searchParams);
  const note = currencyNote(currency, mixed);
  const header = (
    <PageHeader
      title="Neraca Saldo"
      description={`${scopeLabel} · per akhir ${formatPeriod(period.year, period.month)}${note ? ` · ${note}` : ""}`}
      actions={<ScopeBar entities={entityOptions} periods={periodOptions} entity={scope.value} period={period.key} />}
    />
  );
  const all = await withFx(() => trialBalance(prisma, { clientId: client.id, entityIds: scope.entityIds }, period.end));
  if (all instanceof FxMissingError) return <div className="space-y-6">{header}<FxMissing error={all} base={base} /></div>;
  const tb = all.filter((r) => r.net !== 0n);
  const dr = tb.reduce((s, r) => s + r.debit, 0n);
  const cr = tb.reduce((s, r) => s + r.credit, 0n);
  const q = { period: period.key, entity: scope.value };
  return (
    <div className="space-y-6">
      {header}
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
                    <Link className="hover:text-primary" href={withParams(`${base}/ledger/${r.account.code}`, q)}>{r.account.name}</Link>
                    {r.account.isSuspense && <StatusPill className="ml-2" status="REVIEW" label="Perlu review" />}
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
