import { WorkspaceShell } from "@/components/app/workspace-lazy";
import { prisma } from "@/lib/db";
import { accessibleClientWhere, accessView, requireWorkspaceSession, ROLE_LABEL } from "@/lib/auth/session";
import { AccessBanner } from "@/components/app/access-banner";
import { evidenceEnabled } from "@/lib/evidence/config";
import { clientModules } from "@/lib/clients/modules";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireWorkspaceSession();
  const { firm, member } = session;
  const [rows, modules] = await Promise.all([
    prisma.client.findMany({ where: accessibleClientWhere(session), orderBy: { name: "asc" }, select: { id: true, name: true, entities: { select: { id: true, name: true } } } }),
    clientModules(prisma, firm.id),
  ]);
  const clients = rows.map((c) => ({ ...c, modules: modules.get(c.id)?.visible ?? [] }));
  // A company has one set of books (ADR 0017 §1): no client switcher, Ctrl K or client bar.
  const company = firm.kind === "PERUSAHAAN";
  return <WorkspaceShell
    firmName={firm.name}
    clients={clients}
    user={{ name: member.name, role: ROLE_LABEL[member.role] }}
    documents={evidenceEnabled()}
    company={company}
    support={session.support ? { firmName: session.support.firmName, memberName: session.support.memberName, expiresAt: session.support.expiresAt.toISOString() } : null}
    access={accessView(session)}
    banner={<AccessBanner access={session.access} />}
  >{children}</WorkspaceShell>;
}
