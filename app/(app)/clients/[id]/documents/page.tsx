import { notFound, redirect } from "next/navigation";
import { evidenceEnabled, publicEvidenceDemoEnabled } from "@/lib/evidence/config";
import { getClientForFirm } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { oauthConfigured } from "@/lib/evidence/drive";
import { EvidenceHome } from "@/components/app/evidence-workspace";
export default async function ClientDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  if (publicEvidenceDemoEnabled()) redirect("/documents");
  if (!evidenceEnabled()) notFound();
  const { id } = await params;
  const client = await getClientForFirm(id);
  const [intakes, connection] = await Promise.all([
    prisma.evidenceIntake.findMany({ where: { firmId: client.firmId, clientId: id }, select: { id: true, name: true, status: true, clientId: true }, orderBy: { updatedAt: "desc" }, take: 100 }),
    prisma.driveConnection.findUnique({ where: { firmId: client.firmId }, select: { id: true } }),
  ]);
  return <EvidenceHome clientId={id} intakes={intakes} clients={[{ id, name: client.name }]} connected={Boolean(connection)} googleConfigured={oauthConfigured()} />;
}
