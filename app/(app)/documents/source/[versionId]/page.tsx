import Link from "next/link";
import { notFound } from "next/navigation";
import { evidenceEnabled } from "@/lib/evidence/config";
import { getCurrentFirm } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { PageHeader, NextStep } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { ArrowLeft } from "lucide-react";
import type { EvidenceUnit } from "@/lib/evidence/types";
export default async function SourcePage({ params, searchParams }: { params: Promise<{ versionId: string }>; searchParams: Promise<{ at?: string; scope?: string; period?: string; answer?: string }> }) {
  if (!evidenceEnabled()) notFound();
  const { versionId } = await params; const { at, scope, period, answer } = await searchParams; const firm = await getCurrentFirm();
  const version = await prisma.evidenceVersion.findFirst({ where: { id: versionId, firmId: firm.id, document: { firmId: firm.id } }, select: { id: true, name: true, hash: true, units: true, createdAt: true, document: { select: { intakeId: true, currentVersionId: true } } } });
  if (!version) notFound();
  const context = new URLSearchParams();
  if (scope) context.set("scope", scope);
  if (period) context.set("period", period);
  if (answer) context.set("answer", answer);
  const units = version.units as unknown as EvidenceUnit[];
  const matches = (locator: string) => locator === at || Boolean(at && (at.replace(/![A-Z]+(\d+)$/, "!$1") === locator || at.replace(/^CSV!R(\d+)C\d+$/, "baris $1") === locator));
  return <div className="space-y-6"><PageHeader title={version.name} description={`Versi tersimpan ${formatDate(version.createdAt)}`} actions={<>{answer && <Button variant="outline" size="sm" render={<Link href={`/?${context}`} />}><ArrowLeft /> Kembali ke pertanyaan</Button>}<Button variant="outline" size="sm" render={<Link href={`/documents/${version.document.intakeId}?${context}`} />}><ArrowLeft /> Kembali ke dokumen</Button></>} /><NextStep>{version.document.currentVersionId === version.id ? "Periksa kutipan dan konteks sumber. Angka dokumen belum tentu sama dengan buku." : "Ini versi sebelumnya yang dirujuk jawaban. Versi terbaru tersedia di kumpulan dokumen."}</NextStep>{at && <p className="text-sm">Lokasi rujukan: <strong>{at}</strong></p>}{units.map(u => <Card key={u.key}><CardHeader><CardTitle role="heading" aria-level={2}>{u.label}</CardTitle></CardHeader><CardContent className="space-y-3">{u.passages.map((p,i) => <div id={matches(p.locator) ? "cited-source" : encodeURIComponent(p.locator)} key={i} className={`rounded-md p-3 ${matches(p.locator) ? "border border-primary bg-primary-subtle" : "border-b"}`}><span className="text-xs font-medium text-muted-foreground">{p.locator}</span><p className="mt-1 whitespace-pre-wrap break-words text-sm">{p.text}</p></div>)}</CardContent></Card>)}</div>;
}
