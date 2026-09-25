import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar, MobileTrigger } from "@/components/app/app-sidebar";
import { prisma } from "@/lib/db";
import { WorkspaceHistoryProvider } from "@/components/app/workspace-ask";
import { requireWorkspaceSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { firm, user } = await requireWorkspaceSession();
  const clients = await prisma.client.findMany({ where: { firmId: firm.id }, orderBy: { name: "asc" }, select: { id: true, name: true, entities: { select: { id: true } } } });
  return (
    <WorkspaceHistoryProvider key={firm.id + user.id}><SidebarProvider>
      <a href="#workspace-main" className="sr-only z-50 rounded-lg bg-card p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Lewati navigasi</a>
      <AppSidebar firmName={firm.name} clients={clients} userEmail={user.email} />
      <SidebarInset className="min-w-0 bg-background">
        <div className="flex items-center gap-2 border-b bg-card px-4 py-2 md:hidden"><MobileTrigger /><span className="text-sm font-semibold">Buku</span></div>
        <div id="workspace-main" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">{children}</div>
      </SidebarInset>
    </SidebarProvider></WorkspaceHistoryProvider>
  );
}
