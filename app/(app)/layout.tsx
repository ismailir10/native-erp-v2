import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar, MobileTrigger } from "@/components/app/app-sidebar";
import { prisma } from "@/lib/db";
import { WorkspaceHistoryProvider } from "@/components/app/workspace-ask";
import { accessibleClientWhere, accessView, requireWorkspaceSession, ROLE_LABEL } from "@/lib/auth/session";
import { AccessProvider } from "@/components/app/access-context";
import { AccessBanner } from "@/components/app/access-banner";
import { SupportBar } from "@/components/app/support-bar";
import { evidenceEnabled } from "@/lib/evidence/config";
import { NavigationProgress } from "@/components/app/navigation-progress";
import { ClientBar } from "@/components/app/client-bar";
import { ClientSwitcherProvider } from "@/components/app/client-switcher";
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
  const shell = (
    <SidebarProvider>
      <NavigationProgress />
      <a href="#workspace-main" className="sr-only z-50 rounded-lg bg-card p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Lewati navigasi</a>
      <AppSidebar firmName={firm.name} clients={clients} user={{ name: member.name, role: ROLE_LABEL[member.role] }} documents={evidenceEnabled()} company={company} />
      <SidebarInset className="min-w-0 bg-background">
        {session.support && <SupportBar firmName={session.support.firmName} memberName={session.support.memberName} expiresAt={session.support.expiresAt.toISOString()} />}
        <div className="flex items-center gap-2 border-b bg-card px-4 py-2 md:hidden"><MobileTrigger /><span className="text-sm font-semibold">Buku</span></div>
        <div id="workspace-main" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8"><AccessBanner access={session.access} />{!company && <ClientBar />}<AccessProvider value={accessView(session)}>{children}</AccessProvider></div>
      </SidebarInset>
    </SidebarProvider>
  );
  return <WorkspaceHistoryProvider key={firm.id + member.id}>{company ? shell : <ClientSwitcherProvider clients={clients}>{shell}</ClientSwitcherProvider>}</WorkspaceHistoryProvider>;
}
