import { notFound } from "next/navigation";
import { evidenceEnabled } from "@/lib/evidence/config";
import { getCurrentFirm } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { loadWorkspace } from "@/lib/evidence/workspace";
import { EvidenceWorkspace } from "@/components/app/evidence-workspace";
export default async function IntakePage({ params }: { params: Promise<{ intakeId: string }> }) {
  if (!evidenceEnabled()) notFound();
  const { intakeId } = await params;
  const firm = await getCurrentFirm();
  if (!(await prisma.evidenceIntake.findFirst({ where: { id: intakeId, firmId: firm.id }, select: { id: true } }))) notFound();
  const [initial, clients] = await Promise.all([loadWorkspace(prisma, firm.id, intakeId), prisma.client.findMany({ where: { firmId: firm.id }, select: { id: true, name: true } })]);
  return <EvidenceWorkspace key={intakeId} initial={initial} clients={clients} />;
}
