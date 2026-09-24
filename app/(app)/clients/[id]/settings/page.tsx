import { prisma } from "@/lib/db";
import { loadClientPage } from "@/lib/client-page";
import type { SearchParams } from "@/lib/scope";
import { aiConfig } from "@/lib/ai/provider";
import { automationByMonth } from "@/lib/queries";
import { TAX_TAG_LABEL } from "@/lib/coa/template";
import { formatMonthShort } from "@/lib/format";
import { PageHeader, Stat } from "@/components/app/page-header";
import { StatusPill } from "@/components/app/status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { client } = await loadClientPage(params, searchParams);
  const [rules, memories, auto, usage, cacheSize] = await Promise.all([
    prisma.rule.findMany({ where: { firmId: client.firmId, OR: [{ clientId: client.id }, { clientId: null }] }, orderBy: [{ clientId: "asc" }, { priority: "asc" }] }),
    prisma.memory.findMany({ where: { clientId: client.id }, orderBy: { hits: "desc" }, take: 15 }),
    automationByMonth([client.id]),
    prisma.aiUsage.aggregate({ where: { firmId: client.firmId }, _sum: { calls: true, promptTokens: true, completionTokens: true, keysRequested: true } }),
    prisma.aiSuggestion.count(),
  ]);
  const accounts = new Map((await prisma.account.findMany({ where: { clientId: client.id } })).map((a) => [a.code, a.name]));
  const cfg = aiConfig();
  const live = Boolean(cfg.apiKey && cfg.model);
  const lastMonth = auto[auto.length - 1];
  const aiLines = auto.reduce((s, a) => s + a.ai, 0);
  const total = auto.reduce((s, a) => s + a.total, 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Aturan & AI" description="Urutan klasifikasi: transfer → aturan → memori → AI. AI hanya dipakai untuk yang belum pernah dilihat." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Status AI" value={<StatusPill status={live ? "PASS" : "REVIEW"} label={live ? "Aktif" : "Mode aturan saja"} />} hint={live ? `${cfg.model} via ${new URL(cfg.baseUrl).host}` : "Isi AI_API_KEY & AI_MODEL untuk mengaktifkan"} />
        <Stat label="Dikode tanpa AI" value={`${total ? Math.round(((total - aiLines) / total) * 100) : 0}%`} hint={`${total} baris sejak awal`} />
        <Stat label="Panggilan AI (total)" value={usage._sum.calls ?? 0} hint={`${((usage._sum.promptTokens ?? 0) + (usage._sum.completionTokens ?? 0)).toLocaleString("id-ID")} token`} />
        <Stat label="Jawaban AI tersimpan" value={cacheSize} hint="Tidak pernah dibayar dua kali" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Batas pemakaian</CardTitle>
          <CardDescription>
            Maks. {cfg.maxCallsPerImport} panggilan per impor · {cfg.monthlyTokenBudget.toLocaleString("id-ID")} token per bulan · 40 merchant per panggilan.
            {lastMonth && ` Bulan terakhir: ${lastMonth.pct}% dikode otomatis (${formatMonthShort(Number(lastMonth.ym.slice(0, 4)), Number(lastMonth.ym.slice(5)))}).`}
          </CardDescription>
        </CardHeader>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Aturan</CardTitle>
            <CardDescription>Aturan klien menang atas aturan kantor. Buat dari halaman Review dengan “Selalu gunakan akun ini”.</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead className="pl-6">Jika keterangan mengandung</TableHead><TableHead>Arah</TableHead><TableHead>Akun</TableHead><TableHead className="pr-6">Berlaku</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="pl-6 font-mono text-xs">{r.pattern}</TableCell>
                    <TableCell className="text-muted-foreground">{r.direction === "IN" ? "Masuk" : r.direction === "OUT" ? "Keluar" : "Semua"}</TableCell>
                    <TableCell>{r.accountCode} {accounts.get(r.accountCode)}{r.taxTag && <span className="text-xs text-muted-foreground"> · {TAX_TAG_LABEL[r.taxTag]}</span>}</TableCell>
                    <TableCell className="pr-6 text-muted-foreground">{r.clientId ? (r.source === "USER" ? "Klien (dibuat reviewer)" : "Klien") : "Semua klien"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Memori</CardTitle>
            <CardDescription>Dipelajari dari keputusan reviewer — dipakai sebelum AI.</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead className="pl-6">Merchant</TableHead><TableHead>Akun</TableHead><TableHead className="pr-6 text-right">Dikonfirmasi</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {memories.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="pl-6 font-mono text-xs">{m.merchantKey}</TableCell>
                    <TableCell>{m.accountCode} {accounts.get(m.accountCode)}</TableCell>
                    <TableCell className="num pr-6 text-right">{m.hits}×</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
