import { ChevronDown } from "lucide-react";
import type { ExchangeRate } from "@/lib/generated/prisma/client";
import { CURRENCIES, formatRateId, type CurrencyCode } from "@/lib/fx/currency";
import { formatDate } from "@/lib/format";
import { RateRowActions } from "@/components/app/rate-form";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function RateList({ clientId, rates }: { clientId: string; rates: ExchangeRate[] }) {
  if (!rates.length) return <p className="px-6 text-sm text-muted-foreground">Belum ada kurs tercatat untuk klien ini. Tambahkan kurs di formulir, atau impor file yang memuat kurs.</p>;
  const manual = rates.filter((r) => r.source === "MANUAL");
  const files = new Map<string, { file: string; rates: ExchangeRate[] }>();
  for (const rate of rates.filter((r) => r.source === "FILE")) {
    // File notes are saved as `${fileName} ${sheet}!${row}` by the import pipeline.
    const file = rate.note?.match(/^(.*\.(?:xlsx|csv))\s[\s\S]*!\d+$/i)?.[1] ?? rate.note ?? "File impor";
    const key = JSON.stringify([rate.currency, rate.quote, file]);
    const group = files.get(key) ?? { file, rates: [] };
    group.rates.push(rate);
    files.set(key, group);
  }
  return (
    <div className="space-y-2">
      {manual.length > 0 && <RateTable clientId={clientId} rates={manual} />}
      {[...files].map(([key, group]) => {
        const sorted = [...group.rates].sort((a, b) => +a.date - +b.date);
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        return (
          <Collapsible key={key} className="border-t">
            <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-6 py-4 text-left text-sm hover:bg-muted/50 focus-visible:outline-ring">
              <span className="min-w-0">
                <span className="block break-words font-medium">{first.currency} → {first.quote} · {sorted.length} kurs dari {group.file}</span>
                <span className="text-xs text-muted-foreground">{formatDate(first.date)}{+first.date !== +last.date && ` – ${formatDate(last.date)}`}</span>
              </span>
              <ChevronDown className="size-4 shrink-0 transition-transform group-data-panel-open:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <RateTable clientId={clientId} rates={group.rates} />
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}

function RateTable({ clientId, rates }: { clientId: string; rates: ExchangeRate[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-6">Pasangan</TableHead>
          <TableHead>Tanggal</TableHead>
          <TableHead>Jenis</TableHead>
          <TableHead className="text-right">Kurs</TableHead>
          <TableHead className="hidden md:table-cell">Sumber</TableHead>
          <TableHead className="w-12 pr-6" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rates.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="pl-6">
              1 {r.currency} → {r.quote}
              <div className="text-xs text-muted-foreground">{CURRENCIES[r.currency as CurrencyCode]?.name ?? r.currency}</div>
            </TableCell>
            <TableCell>{formatDate(r.date)}</TableCell>
            <TableCell>{r.kind === "SPOT" ? "Penutup" : "Rata-rata"}</TableCell>
            <TableCell className="num text-right">{formatRateId(r.rate)}</TableCell>
            <TableCell className="hidden text-xs text-muted-foreground md:table-cell">{r.source === "MANUAL" ? "Manual" : `File${r.note ? ` · ${r.note}` : ""}`}</TableCell>
            <TableCell className="pr-6 text-right">
              <RateRowActions clientId={clientId} rateId={r.id} label={`${r.currency}→${r.quote} ${formatDate(r.date)}`} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
