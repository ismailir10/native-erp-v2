import { notFound } from "next/navigation";
import { evidenceEnabled } from "@/lib/evidence/config";
import { getCurrentFirm } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { oauthConfigured } from "@/lib/evidence/drive";
import { EvidenceHome } from "@/components/app/evidence-workspace";
export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  if (!evidenceEnabled()) notFound();
  const firm = await getCurrentFirm();
  const { google } = await searchParams;
  const googleResult = google === "connected" || google === "error" ? google : undefined;
  const [intakes, clients, connection] = await Promise.all([
    prisma.evidenceIntake.findMany({ where: { firmId: firm.id }, select: { id: true, name: true, status: true, clientId: true }, orderBy: { updatedAt: "desc" }, take: 100 }),
    prisma.client.findMany({ where: { firmId: firm.id }, select: { id: true, name: true } }),
    prisma.driveConnection.findUnique({ where: { firmId: firm.id }, select: { id: true } }),
  ]);
  return <EvidenceHome googleResult={googleResult} intakes={intakes} clients={clients} connected={Boolean(connection)} googleConfigured={oauthConfigured()} />;
}
