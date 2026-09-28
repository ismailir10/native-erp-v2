import { prisma } from "@/lib/db";
import { loadClientPage } from "@/lib/client-page";
import type { SearchParams } from "@/lib/scope";
import { formatDate, formatPeriod, toIsoDate } from "@/lib/format";
import { ScopeBar } from "@/components/app/scope-bar";
import { ScheduleProposals } from "@/components/app/schedule-proposals";
import { SchedulePanel } from "@/components/app/schedule-panel";
import { candidateViews, proposalViews, scheduleViews } from "@/lib/adjust/view";
import { Money } from "@/components/app/money";
import { NextStep, PageHeader } from "@/components/app/page-header";
import { JournalForm } from "@/components/app/journal-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function NewJournalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { client, period, periodOptions } = await loadClientPage(params, searchParams);
  const [due, candidates, schedules, p] = await Promise.all([
    proposalViews(prisma, client.id, period.year, period.month),
    candidateViews(prisma, client.id, period.year, period.month),
    scheduleViews(prisma, client.id),
    prisma.period.findUnique({ where: { clientId_year_month: { clientId: client.id, year: period.year, month: period.month } }, select: { status: true } }),
  ]);
  const locked = p?.status === "LOCKED";
  const label = formatPeriod(period.year, period.month);
  const next = period.month === 12 ? `${period.year + 1}-01` : `${period.year}-${String(period.month + 1).padStart(2, "0")}`;
  // Companies first: an adjusting entry almost always belongs to the PT/CV, not the owner.
  const entities = [...client.entities].sort((a, b) => Number(a.kind === "PERORANGAN") - Number(b.kind === "PERORANGAN")).map((e) => ({ id: e.id, name: e.name, currency: e.functionalCurrency }));
  const accounts = await prisma.account.findMany({ where: { clientId: client.id, isSuspense: false }, orderBy: { code: "asc" } });
  const recent = await prisma.journalEntry.findMany({
    where: { entity: { clientId: client.id }, kind: "ADJUSTMENT" },
    include: { entity: true, lines: true },
    orderBy: { date: "desc" },
    take: 8,
  });
  return (
    <div className="space-y-6">
      <PageHeader title="Jurnal Penyesuaian" description="Untuk yang tidak lewat bank: penyusutan, akrual, piutang." actions={<ScopeBar entities={[]} periods={periodOptions} period={period.key} />} />
      {locked ? (
        <NextStep tone="done">Buku {label} sudah ditutup. Jurnal ke periode ini ditolak.</NextStep>
      ) : due.length ? (
        <NextStep>Catat {due.length} jurnal terjadwal {label} di bawah, lalu tambahkan penyesuaian lain bila perlu.</NextStep>
      ) : candidates.length ? (
        <NextStep>Buat jadwal untuk kandidat di bawah bila perlu, atau catat jurnal bebas.</NextStep>
      ) : (
        <NextStep>Pilih perusahaan dan tanggal, isi baris sampai debit dan kredit seimbang, lalu simpan.</NextStep>
      )}
      {due.length > 0 && <ScheduleProposals clientId={client.id} year={period.year} month={period.month} periodLabel={label} items={due} locked={locked} />}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="pt-6">
            <JournalForm
              clientId={client.id}
              entities={entities}
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
      <SchedulePanel clientId={client.id} entities={entities} accounts={accounts.filter((a) => !a.isBank && !a.isClearing).map((a) => ({ code: a.code, name: a.name, type: a.type, fsLine: a.fsLine }))} candidates={candidates} schedules={schedules} nextMonth={next} />
    </div>
  );
}
