import Link from "next/link";
import { notFound } from "next/navigation";
import { evidenceEnabled } from "@/lib/evidence/config";
import { getCurrentFirm } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { oauthConfigured } from "@/lib/evidence/drive";
import { EvidenceHome } from "@/components/app/evidence-workspace";
import { WorkspaceScopeBar } from "@/components/app/workspace-scope";
import { resolveWorkspaceScope, workspaceHref, WorkspaceInputError } from "@/lib/workspace";
import type { SearchParams } from "@/lib/scope";

export default async function DocumentsPage({ searchParams }: { searchParams: SearchParams }) {
  const firm = await getCurrentFirm();
  if (!evidenceEnabled()) notFound();
  const input = await searchParams;
  const scope = await resolveWorkspaceScope(prisma, firm.id, { scope: typeof input.scope === "string" ? input.scope : undefined, period: typeof input.period === "string" ? input.period : undefined }).catch(error => { if (error instanceof WorkspaceInputError) notFound(); throw error; });
  const googleResult = input.google === "connected" || input.google === "error" ? input.google : undefined;
  const googleReason = googleResult === "error" && typeof input.reason === "string" ? input.reason : undefined;
  const selections = scope.kind === "entity" ? await prisma.evidenceSelection.findMany({ where: { firmId: firm.id, confirmed: true, entityId: { in: scope.entityIds } }, select: { intakeId: true, versionId: true } }) : [];
  const current = scope.kind === "entity" ? await prisma.evidenceDocument.findMany({ where: { firmId: firm.id, excluded: false, currentVersionId: { in: selections.map(s => s.versionId) } }, select: { intakeId: true } }) : [];
  const [intakes, connection] = await Promise.all([
    prisma.evidenceIntake.findMany({ where: { firmId: firm.id, ...(scope.kind !== "all" ? { clientId: { in: scope.clientIds } } : {}), ...(scope.kind === "entity" ? { id: { in: current.map(d => d.intakeId) } } : {}) }, select: { id: true, name: true, status: true, clientId: true }, orderBy: { updatedAt: "desc" }, take: 100 }),
    prisma.driveConnection.findUnique({ where: { firmId: firm.id }, select: { id: true } }),
  ]);
  return <EvidenceHome
    actions={<WorkspaceScopeBar scope={scope} />}
    note={<p className="text-sm text-muted-foreground">Kumpulan dokumen dapat memuat beberapa periode. Periode terpilih digunakan saat bertanya dan membuka laporan.{scope.kind === "entity" && <> Hanya kumpulan dengan perusahaan terkonfirmasi ditampilkan. <Link className="text-primary underline" href={workspaceHref("/documents", { key: `client:${scope.clientIds[0]}`, period: scope.period })}>Lihat dokumen grup yang belum dikonfirmasi</Link>.</>}</p>}
    googleResult={googleResult} googleReason={googleReason} intakes={intakes} clients={scope.clients.map(c => ({ id: c.id, name: c.name }))} clientId={scope.kind === "all" ? undefined : scope.clientIds[0]} connected={Boolean(connection)} googleConfigured={oauthConfigured()} />;
}
