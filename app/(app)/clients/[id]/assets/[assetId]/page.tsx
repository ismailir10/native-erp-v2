import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { loadClientPage } from "@/lib/client-page";
import type { SearchParams } from "@/lib/scope";
import { formatDate } from "@/lib/format";
import { assetDetail } from "@/lib/assets/register";
import { TAX_GROUPS } from "@/lib/assets/fiscal";
import { PageHeader } from "@/components/app/page-header";
import { Money } from "@/components/app/money";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const KIND = { ACQUIRED: "Perolehan", OPENING: "Saldo Awal", DEPRECIATION: "Penyusutan", DISPOSAL: "Pelepasan" } as const;

/** One asset's register figures down to their entries (accounting-rules 5b; ui-rules: every number drills to its source). */
export default async function AssetDetailPage({ params, searchParams }: { params: Promise<{ id: string; assetId: string }>; searchParams: SearchParams }) {
  const { client, base, period } = await loadClientPage(params, searchParams);
  const { assetId } = await params;
  const detail = await assetDetail(prisma, client.id, assetId);
  if (!detail) notFound();
  const { asset, moves } = detail;
  const cur = asset.entity.functionalCurrency;
  // Running balances after each movement.
  const rows = moves.reduce<((typeof moves)[number] & { costAfter: bigint; accumulatedAfter: bigint })[]>((out, m) => {
    const prev = out.at(-1);
    return [...out, { ...m, costAfter: (prev?.costAfter ?? 0n) + m.cost, accumulatedAfter: (prev?.accumulatedAfter ?? 0n) + m.accumulated }];
  }, []);
  const back = `${base}/assets?period=${period.key}&entity=${asset.entity.id}`;
  return (
    <div className="space-y-6">
      <PageHeader
        title={asset.name}
        description={`${asset.entity.name} · ${TAX_GROUPS[asset.taxGroup].label} · diperoleh ${formatDate(asset.acquiredOn)} · ${asset.assetAccount.code} ${asset.assetAccount.name}${asset.accumulatedAccount ? ` / ${asset.accumulatedAccount.code}` : ""}`}
        actions={<Link href={back} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"><ChevronLeft className="size-4" /> Aset Tetap</Link>}
      />
      <Card>
        <CardHeader>
          <CardTitle>Asal angka di daftar aset</CardTitle>
          <CardDescription>Setiap perolehan, penyusutan dan pelepasan aset ini, dengan saldo setelahnya. Klik tanggal untuk membuka buku besar bulan itu.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Tanggal</TableHead>
                <TableHead>Keterangan</TableHead>
                <TableHead className="hidden text-right md:table-cell">Harga perolehan</TableHead>
                <TableHead className="hidden text-right md:table-cell">Penyusutan</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Akum. penyusutan</TableHead>
                <TableHead className="pr-6 text-right">Nilai buku</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={`${r.entryId ?? "x"}-${i}`} data-testid={`movement-${r.kind}`}>
                  <TableCell className="pl-6 whitespace-nowrap">
                    {r.ledger ? (
                      <Link href={`${base}/ledger/${r.ledger.code}?entity=${asset.entity.id}&period=${r.ledger.year}-${String(r.ledger.month).padStart(2, "0")}`} className="underline-offset-2 hover:text-primary hover:underline">{formatDate(r.date)}</Link>
                    ) : formatDate(r.date)}
                  </TableCell>
                  <TableCell className="whitespace-normal"><span className="text-muted-foreground">{KIND[r.kind]} · </span>{r.label}</TableCell>
                  <TableCell className="hidden text-right md:table-cell"><Money value={r.cost} currency={cur} /></TableCell>
                  <TableCell className="hidden text-right md:table-cell"><Money value={r.accumulated} currency={cur} /></TableCell>
                  <TableCell className="hidden text-right sm:table-cell"><Money value={-r.accumulatedAfter} currency={cur} /></TableCell>
                  <TableCell className="pr-6 text-right"><Money strong value={r.costAfter - r.accumulatedAfter} currency={cur} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
