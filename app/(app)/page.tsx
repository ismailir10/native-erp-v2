import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getCurrentFirm } from "@/lib/tenant";
import { automationByMonth, clientStatuses, STATE_LABEL } from "@/lib/queries";
import { formatDate, formatPeriod } from "@/lib/format";
import { workingMonth } from "@/lib/periods";
import { prisma } from "@/lib/db";
import { NextStep, PageHeader, Stat } from "@/components/app/page-header";
import { StatusPill } from "@/components/app/status";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function HomePage() {
  const firm = await getCurrentFirm();
  const clientIds = (await prisma.client.findMany({ where: { firmId: firm.id }, select: { id: true } })).map((c) => c.id);
  const { year, month } = await workingMonth(clientIds);
  const order = { FAIL: 0, WAITING: 1, REVIEW: 2, ACK: 3, READY: 4, LOCKED: 5 } as const;
  const rows = (await clientStatuses(firm.id, year, month)).sort((a, b) => order[a.state] - order[b.state]);
  const auto = await automationByMonth(rows.map((r) => r.client.id));
  const current = auto.find((a) => a.ym === `${year}-${String(month).padStart(2, "0")}`);
  const first = auto[0];
  const totalReview = rows.reduce((s, r) => s + r.openReview, 0);
  const locked = rows.filter((r) => r.state === "LOCKED").length;
  const priority = [...rows].filter((r) => r.state !== "LOCKED").sort((a, b) => b.openReview + b.counts.REVIEW * 2 - (a.openReview + a.counts.REVIEW * 2))[0];

  return (
    <div className="space-y-6">
      <PageHeader title="Beranda" description={`Tutup buku ${formatPeriod(year, month)} · ${rows.length} klien`} />

      {priority ? (
        <NextStep href={`/clients/${priority.client.id}${priority.missingStatements ? "/import" : priority.openReview ? "/review" : "/close"}`} cta="Kerjakan">
          {priority.client.name}{" "}
          {priority.missingStatements
            ? `menunggu ${priority.missingStatements} mutasi bank untuk ${formatPeriod(year, month)}.`
            : priority.openReview
              ? `punya ${priority.openReview} transaksi yang perlu dicek.`
              : "siap ditutup."}
        </NextStep>
      ) : (
        <NextStep tone="done">Semua klien sudah tutup buku {formatPeriod(year, month)}.</NextStep>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label="Klien selesai tutup buku" value={`${locked} / ${rows.length}`} hint={formatPeriod(year, month)} />
        <Stat label="Transaksi perlu review" value={totalReview} hint="Semua klien" />
        <Stat label="Dikode otomatis bulan ini" value={`${current?.pct ?? 0}%`} hint={first && current && first.ym !== current.ym ? `${current.pct >= first.pct ? "Naik" : "Turun"} dari ${first.pct}% di bulan pertama` : undefined} />
        <Stat label="Mutasi diproses bulan ini" value={current?.total ?? 0} hint="Baris rekening koran" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Klien</CardTitle>
          <CardDescription>Status tutup buku {formatPeriod(year, month)}</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Klien</TableHead>
                <TableHead className="hidden md:table-cell">Entitas</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Perlu review</TableHead>
                <TableHead className="hidden md:table-cell">Impor terakhir</TableHead>
                <TableHead className="w-8 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const s = STATE_LABEL[r.state];
                return (
                  <TableRow key={r.client.id}>
                    <TableCell className="pl-6">
                      <Link href={`/clients/${r.client.id}`} className="font-medium hover:text-primary">
                        {r.client.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{r.client.industry}</div>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{r.client.entities.map((e) => e.shortName).join(", ")}</TableCell>
                    <TableCell>
                      <StatusPill status={s.status} label={s.label} />
                    </TableCell>
                    <TableCell className="num hidden text-right sm:table-cell">{r.openReview || "–"}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{r.lastImport ? formatDate(r.lastImport.createdAt) : "–"}</TableCell>
                    <TableCell className="pr-4 text-right">
                      <Link href={`/clients/${r.client.id}`} aria-label={`Buka ${r.client.name}`} className="inline-flex text-muted-foreground hover:text-primary">
                        <ChevronRight className="size-4" />
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
