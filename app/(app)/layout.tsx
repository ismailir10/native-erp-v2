import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar, MobileTrigger } from "@/components/app/app-sidebar";
import { getCurrentFirm } from "@/lib/tenant";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
// Import and "Reset data demo" run many sequential queries against Neon; give them room (capped by plan).
export const maxDuration = 300;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const firm = await getCurrentFirm();
  const clients = await prisma.client.findMany({ where: { firmId: firm.id }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const open = await prisma.bankTransaction.groupBy({ by: ["entityId"], where: { firmId: firm.id, status: "NEEDS_REVIEW" }, _count: true });
  const entities = await prisma.entity.findMany({ where: { firmId: firm.id }, select: { id: true, clientId: true } });
  const reviewCounts: Record<string, number> = {};
  for (const o of open) {
    const cid = entities.find((e) => e.id === o.entityId)?.clientId;
    if (cid) reviewCounts[cid] = (reviewCounts[cid] ?? 0) + o._count;
  }
  return (
    <SidebarProvider>
      <AppSidebar firmName={firm.name} clients={clients} reviewCounts={reviewCounts} demoMode={process.env.DEMO_MODE === "true"} />
      <SidebarInset className="bg-background">
        <div className="flex items-center gap-2 border-b bg-card px-4 py-2 md:hidden">
          <MobileTrigger />
          <span className="text-sm font-semibold">Buku</span>
        </div>
        <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
