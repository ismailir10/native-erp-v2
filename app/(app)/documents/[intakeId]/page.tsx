import { notFound } from "next/navigation";
import { evidenceEnabled } from "@/lib/evidence/config";
import { accessibleClientWhere, intakeVisibleWhere, requireWorkspaceSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { loadWorkspace } from "@/lib/evidence/workspace";
import { EvidenceWorkspace } from "@/components/app/evidence-workspace";

export const metadata = { title: "Dokumen" };
export default async function IntakePage({ params }: { params: Promise<{ intakeId: string }> }) {
  if (!evidenceEnabled()) notFound();
  const { intakeId } = await params;
  const session = await requireWorkspaceSession();
  const { firm } = session;
  // An intake linked to a client the member may not open is "not found", like the client itself.
  if (!(await prisma.evidenceIntake.findFirst({ where: { id: intakeId, firmId: firm.id, ...intakeVisibleWhere(session) }, select: { id: true } }))) notFound();
  const [initial, clients] = await Promise.all([loadWorkspace(prisma, firm.id, intakeId), prisma.client.findMany({ where: accessibleClientWhere(session), select: { id: true, name: true } })]);
  return <EvidenceWorkspace key={intakeId} initial={initial} clients={clients} />;
}
