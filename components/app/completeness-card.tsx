import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill } from "@/components/app/status";
import { formatMonthShort } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import type { CompletenessCell, CompletenessRow } from "@/lib/controls/completeness";

/** Bank account (and ledger file) × month: where the data is, where it is missing, where it doesn't hand over (UC-B4, I1a). */
export function CompletenessCard({ months, rows, importHref }: { months: { year: number; month: number }[]; rows: CompletenessRow[]; importHref?: string }) {
  const gaps = rows.flatMap((r) => r.cells).filter((c) => c.state === "missing" || c.state === "broken").length;
  return (
    <Card data-testid="completeness">
      <CardHeader>
        <CardTitle>Kelengkapan data</CardTitle>
        <CardDescription>
          {gaps
            ? `${gaps} bulan data bolong atau tidak nyambung. Laporan bulan itu tetap draf sampai datanya lengkap.`
            : "Setiap rekening dan buku besar punya data yang nyambung untuk bulan-bulan ini."}{" "}
          Tanda – berarti pembukuannya belum dimulai.{" "}
          {importHref && <Link href={importHref} className="font-medium text-primary hover:underline">Impor data</Link>}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="eyebrow min-w-48 pl-6">Rekening</TableHead>
                {months.map((m) => <TableHead key={`${m.year}-${m.month}`} className="eyebrow min-w-28">{formatMonthShort(m.year, m.month)}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.bankAccountId} data-testid="completeness-row">
                  <TableCell className="pl-6">
                    <div className="font-medium">{r.label}</div>
                    <div className="text-xs text-muted-foreground">{r.entity}</div>
                  </TableCell>
                  {r.cells.map((c) => <Cell key={`${c.year}-${c.month}`} cell={c} currency={r.currency} />)}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function Cell({ cell, currency }: { cell: CompletenessCell; currency: string }) {
  if (cell.state === "before") return <TableCell className="text-muted-foreground">–</TableCell>;
  if (cell.state === "ok") return <TableCell><StatusPill status="PASS" label="Ada" /></TableCell>;
  if (cell.state === "missing") return <TableCell><StatusPill status="FAIL" label="Bolong" /></TableCell>;
  return (
    <TableCell className="align-top">
      <StatusPill status="REVIEW" label="Tidak nyambung" />
      {cell.diff !== null && <div className="num mt-1 text-xs">Selisih {formatMoney(cell.diff, currency)}</div>}
      {cell.note && <div className="mt-1 max-w-56 whitespace-normal text-xs text-muted-foreground">{cell.note}</div>}
    </TableCell>
  );
}
