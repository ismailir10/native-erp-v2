"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import {
  BookOpen,
  Building2,
  Coins,
  ChevronRight,
  ClipboardCheck,
  FileSpreadsheet,
  Home,
  Inbox,
  Landmark,
  LayoutDashboard,
  NotebookPen,
  RotateCcw,
  Scale,
  Settings2,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { resetDemoAction } from "@/app/actions";

/** Order = the monthly close workflow, top to bottom. */
const CLIENT_NAV = [
  { href: "", label: "Ringkasan", icon: LayoutDashboard },
  { href: "/documents", label: "Dokumen", icon: FileSpreadsheet },
  { href: "/opening", label: "Saldo Awal", icon: Landmark },
  { href: "/import", label: "Impor Mutasi", icon: Upload },
  { href: "/review", label: "Review", icon: Inbox, badge: true },
  { href: "/ledger", label: "Buku Besar", icon: BookOpen },
  { href: "/trial-balance", label: "Neraca Saldo", icon: Scale },
  { href: "/reports", label: "Laporan Keuangan", icon: FileSpreadsheet },
  { href: "/journals/new", label: "Jurnal Penyesuaian", icon: NotebookPen },
  { href: "/close", label: "Tutup Buku", icon: ClipboardCheck },
  { href: "/rates", label: "Kurs", icon: Coins },
  { href: "/settings", label: "Aturan & AI", icon: Settings2 },
];

export function AppSidebar({
  firmName,
  clients,
  reviewCounts,
  demoMode,
  evidenceEnabled = false,
}: {
  firmName: string;
  clients: { id: string; name: string }[];
  reviewCounts: Record<string, number>;
  demoMode: boolean;
  evidenceEnabled?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, start] = useTransition();
  const activeClient = clients.find((c) => pathname.startsWith(`/clients/${c.id}`));

  return (
    <Sidebar>
      <SidebarHeader className="border-b">
        <Link href="/" className="flex items-center gap-2 px-2 py-1.5">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">B</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold leading-tight">Buku</span>
            <span className="block truncate text-xs text-muted-foreground">{firmName}</span>
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton isActive={pathname === "/"} render={<Link href="/" />}>
                <Home />
                <span>Beranda</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {evidenceEnabled && <SidebarMenuItem><SidebarMenuButton isActive={pathname.startsWith("/documents")} render={<Link href="/documents" />}><FileSpreadsheet /><span>Dokumen</span></SidebarMenuButton></SidebarMenuItem>}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Klien</SidebarGroupLabel>
          <SidebarMenu>
            {clients.map((c) => {
              const isActive = activeClient?.id === c.id;
              const base = `/clients/${c.id}`;
              return (
                <SidebarMenuItem key={c.id}>
                  <SidebarMenuButton isActive={isActive && pathname === base} render={<Link href={base} />}>
                    <Building2 />
                    <span className="truncate">{c.name}</span>
                    {!isActive && <ChevronRight className="ml-auto opacity-40" />}
                  </SidebarMenuButton>
                  {!isActive && reviewCounts[c.id] ? <SidebarMenuBadge className="mr-5">{reviewCounts[c.id]}</SidebarMenuBadge> : null}
                  {isActive && (
                    <SidebarMenuSub>
                      {CLIENT_NAV.slice(1).filter(n => evidenceEnabled || n.href !== "/documents").map((n) => {
                        const href = `${base}${n.href}`;
                        const Icon = n.icon;
                        return (
                          <SidebarMenuSubItem key={n.href}>
                            <SidebarMenuSubButton isActive={pathname.startsWith(href)} render={<Link href={href} />}>
                              <Icon />
                              <span>{n.label}</span>
                              {n.badge && reviewCounts[c.id] ? (
                                <span className="num ml-auto rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{reviewCounts[c.id]}</span>
                              ) : null}
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        );
                      })}
                    </SidebarMenuSub>
                  )}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={pathname === "/settings"} render={<Link href="/settings" />}>
              <SlidersHorizontal />
              <span>Pengaturan</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {demoMode && (
          <AlertDialog>
            <AlertDialogTrigger render={<SidebarMenuButton disabled={pending} className="text-muted-foreground" />}>
              <RotateCcw className={pending ? "animate-spin" : ""} />
              <span>{pending ? "Menyiapkan ulang…" : "Reset data demo"}</span>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset data demo?</AlertDialogTitle>
                <AlertDialogDescription>
                  Semua perubahan di demo dihapus, lalu data 3 klien dibangun ulang lewat proses impor yang sama. Butuh sekitar 20 detik dan tidak memakai kredit AI.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Batal</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    start(async () => {
                      const r = await resetDemoAction();
                      if (r.ok) {
                        toast.success("Data demo siap");
                        router.push("/");
                        router.refresh();
                      } else toast.error(r.error);
                    })
                  }
                >
                  Reset
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}

export function MobileTrigger() {
  return <SidebarTrigger className="md:hidden" />;
}
