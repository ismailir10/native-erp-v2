import Link from "next/link";
import { prisma } from "@/lib/db";
import { loadClientPage } from "@/lib/client-page";
import type { SearchParams } from "@/lib/scope";
import { formatDateTime } from "@/lib/format";
import { AUDIT_KIND_LABEL, listEvents, type AuditKind } from "@/lib/audit";
import { NextStep, PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const metadata = { title: "Riwayat perubahan" };

const KINDS = Object.keys(AUDIT_KIND_LABEL) as AuditKind[];

/** Riwayat perubahan (ADR 0013): who changed what, when, from what to what — newest first, one kind at a time if asked. */
export default async function HistoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { client, base, sp } = await loadClientPage(params, searchParams);
  const kind = KINDS.includes(sp.kind as AuditKind) ? (sp.kind as AuditKind) : undefined;
  const events = await listEvents(prisma, client.id, { kind, take: 300 });
  const chip = (k: AuditKind | undefined, label: string) => (
    <Link
      key={label}
      href={k ? `${base}/history?kind=${k}` : `${base}/history`}
      className={cn("rounded-sm border px-2 py-1 text-xs", kind === k ? "border-primary bg-primary-subtle text-primary" : "text-muted-foreground hover:text-foreground")}
      aria-current={kind === k ? "page" : undefined}
    >
      {label}
    </Link>
  );
  return (
    <div className="space-y-6">
      <PageHeader title="Riwayat perubahan" description={`${client.name} · siapa mengubah apa, kapan, dari apa ke apa`} />
      <NextStep>Setiap perubahan klasifikasi, pasangan transfer, impor yang dihapus, catatan kontrol, pemetaan akun dan temuan tercatat di sini dan tidak bisa diubah.</NextStep>
      <nav className="flex flex-wrap gap-2" aria-label="Jenis perubahan">
        {chip(undefined, "Semua")}
        {KINDS.map((k) => chip(k, AUDIT_KIND_LABEL[k]))}
      </nav>
      <Card>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="eyebrow w-44 pl-6">Waktu</TableHead>
                <TableHead className="eyebrow hidden w-48 md:table-cell">Jenis</TableHead>
                <TableHead className="eyebrow">Perubahan</TableHead>
                <TableHead className="eyebrow hidden w-40 pr-6 md:table-cell">Oleh</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.length === 0 && (
                <TableRow><TableCell colSpan={4} className="pl-6 text-muted-foreground">Belum ada perubahan tercatat{kind ? ` untuk ${AUDIT_KIND_LABEL[kind].toLowerCase()}` : ""}.</TableCell></TableRow>
              )}
              {events.map((e) => (
                <TableRow key={e.id} data-testid="history-row">
                  <TableCell className="num pl-6 align-top whitespace-nowrap text-muted-foreground">{formatDateTime(e.at)}</TableCell>
                  <TableCell className="hidden align-top md:table-cell">{e.label}</TableCell>
                  <TableCell className="align-top whitespace-normal">
                    {e.summary}
                    <span className="mt-1 block text-xs text-muted-foreground md:hidden">{e.label} · {e.actor}</span>
                  </TableCell>
                  <TableCell className="hidden pr-6 align-top md:table-cell">{e.actor}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
