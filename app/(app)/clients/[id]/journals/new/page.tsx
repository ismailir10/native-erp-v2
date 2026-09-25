import { prisma } from "@/lib/db";
import { loadClientPage } from "@/lib/client-page";
import type { SearchParams } from "@/lib/scope";
import { formatDate, toIsoDate } from "@/lib/format";
import { Money } from "@/components/app/money";
import { NextStep, PageHeader } from "@/components/app/page-header";
import { JournalForm } from "@/components/app/journal-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function NewJournalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { client, period } = await loadClientPage(params, searchParams);
  const accounts = await prisma.account.findMany({ where: { clientId: client.id, isSuspense: false }, orderBy: { code: "asc" } });
  const recent = await prisma.journalEntry.findMany({
    where: { entity: { clientId: client.id }, kind: "ADJUSTMENT" },
    include: { entity: true, lines: true },
    orderBy: { date: "desc" },
    take: 8,
  });
  return (
    <div className="space-y-6">
      <PageHeader title="Jurnal Penyesuaian" description="Untuk yang tidak lewat bank: penyusutan, akrual, piutang." />
      <NextStep>Pilih perusahaan dan tanggal, isi baris sampai debit dan kredit seimbang, lalu simpan.</NextStep>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="pt-6">
            <JournalForm
              clientId={client.id}
              // Companies first: an adjusting entry almost always belongs to the PT/CV, not the owner.
              entities={[...client.entities].sort((a, b) => Number(a.kind === "PERORANGAN") - Number(b.kind === "PERORANGAN")).map((e) => ({ id: e.id, name: e.name }))}
              accounts={accounts.map((a) => ({ code: a.code, name: a.name }))}
              defaultDate={toIsoDate(period.end)}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Terakhir dicatat</CardTitle>
            <CardDescription>Jurnal penyesuaian klien ini</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {recent.map((e) => (
              <div key={e.id} className="flex justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate">{e.memo}</div>
                  <div className="text-xs text-muted-foreground">{formatDate(e.date)} · {e.entity.shortName}</div>
                </div>
                <Money className="shrink-0" value={e.lines.reduce((s, l) => s + l.debit, 0n)} currency={e.entity.functionalCurrency} />
              </div>
            ))}
            {recent.length === 0 && <p className="text-muted-foreground">Belum ada jurnal penyesuaian untuk klien ini.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
