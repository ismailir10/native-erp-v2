import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { loadClientPage } from "@/lib/client-page";
import { type SearchParams, withParams } from "@/lib/scope";
import { formatPeriod } from "@/lib/format";
import { NextStep, PageHeader } from "@/components/app/page-header";
import { ScopeBar } from "@/components/app/scope-bar";
import { LedgerTable } from "@/components/app/ledger-table";
import { Card, CardContent } from "@/components/ui/card";
import { accountLedger, sourceLedgerBasis } from "@/lib/reports/account-ledger";
import { sourceAccountLabel } from "@/lib/ledger-import/code";

export const metadata = { title: "Buku Besar" };

/** Ledger of one of the client's own accounts (from their ledger or Neraca file), every line down to its source row. */
export default async function ClientAccountLedger({ params, searchParams }: { params: Promise<{ id: string; sourceAccountId: string }>; searchParams: SearchParams }) {
  const { sourceAccountId } = await params;
  const { client, period, periodOptions, base } = await loadClientPage(params, searchParams);
  const src = await prisma.sourceAccount.findFirst({ where: { id: sourceAccountId, clientId: client.id }, include: { account: true, entity: true } });
  if (!src) notFound();
  // Read by, and linked to, the account its lines were posted to by this period, so a later remap doesn't reinterpret history.
  const { normalBalance, account } = await sourceLedgerBasis(prisma, src, period.end);
  const { opening, rows } = await accountLedger(prisma, { sourceAccountId: src.id, entityIds: [src.entityId], start: period.start, end: period.end, normalBalance });
  const q = { period: period.key, entity: src.entityId };
  return (
    <div className="space-y-6">
      <Link href={withParams(`${base}/ledger`, q)} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> Buku Besar
      </Link>
      <PageHeader
        title={sourceAccountLabel(src)}
        description={`${src.entity.name} · akun klien · ${formatPeriod(period.year, period.month)} · klik baris untuk melihat sumbernya`}
        actions={<ScopeBar entities={[]} periods={periodOptions} period={period.key} />}
      />
      {account ? (
        <NextStep href={withParams(`${base}/ledger/${account.code}`, q)} cta={`Lihat ${account.code}`}>
          Di laporan keuangan akun ini masuk {account.code} {account.name}.
        </NextStep>
      ) : (
        <NextStep>Akun ini belum dipetakan ke bagan akun Buku.</NextStep>
      )}
      <Card>
        <CardContent className="px-0">
          <LedgerTable rows={rows} opening={opening.toString()} currency={src.entity.functionalCurrency} />
          {rows.length === 0 && <p className="px-6 py-8 text-center text-sm text-muted-foreground">Tidak ada transaksi di periode ini.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
