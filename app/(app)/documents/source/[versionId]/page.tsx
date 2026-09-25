import Link from "next/link";
import { notFound } from "next/navigation";
import { evidenceEnabled } from "@/lib/evidence/config";
import { getCurrentFirm } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { PageHeader, NextStep } from "@/components/app/page-header";
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
  return <div className="space-y-6"><PageHeader title={version.name} description={`Versi tersimpan ${version.createdAt.toISOString().slice(0, 10)} · ${version.hash.slice(0, 12)}`} actions={<div className="flex flex-wrap gap-3">{answer && <Link href={`/?${context}`} className="text-sm text-primary">Kembali ke pertanyaan</Link>}<Link href={`/documents/${version.document.intakeId}?${context}`} className="text-sm text-primary">Kembali ke dokumen</Link></div>} /><NextStep>{version.document.currentVersionId === version.id ? "Periksa kutipan dan konteks sumber. Angka dokumen belum tentu sama dengan buku." : "Ini versi sebelumnya yang dirujuk jawaban. Versi terbaru tersedia di kumpulan dokumen."}</NextStep>{at && <p className="text-sm">Lokasi rujukan: <strong>{at}</strong></p>}{units.map(u => <section key={u.key} className="space-y-3 rounded-lg border bg-card p-4"><h2 className="font-semibold">{u.label}</h2>{u.passages.map((p,i) => <div id={matches(p.locator) ? "cited-source" : encodeURIComponent(p.locator)} key={i} className={`rounded-md p-3 ${matches(p.locator) ? "border border-primary bg-primary-subtle" : "border-b"}`}><span className="text-xs font-medium text-muted-foreground">{p.locator}</span><p className="mt-1 whitespace-pre-wrap break-words text-sm">{p.text}</p></div>)}</section>)}</div>;
}
