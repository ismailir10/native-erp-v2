"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BookOpen, Building2, ChartColumn, ChevronDown, ClipboardCheck, Coins, FileSpreadsheet, FolderOpen, Home, Inbox, Landmark, ListChecks, ListFilter, LogOut, NotebookPen, Plus, Scale, Settings2, SlidersHorizontal, Upload } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BrandMark } from "@/components/app/brand-mark";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { signOutAction } from "@/app/login/actions";

type Client = { id: string; name: string; entities: { id: string }[] };
const DESTINATIONS = [
  { href: "/", label: "Beranda", icon: Home },
  { href: "/work", label: "Pekerjaan", icon: ListChecks },
  { href: "/documents", label: "Dokumen", icon: FolderOpen },
  { href: "/reports", label: "Laporan", icon: ChartColumn },
];
const ACCOUNTING = [
  { href: "/review", label: "Review transaksi", icon: Inbox },
  { href: "/ledger", label: "Buku Besar", icon: BookOpen },
  { href: "/trial-balance", label: "Neraca Saldo", icon: Scale },
  { href: "/reports", label: "Laporan Keuangan", icon: FileSpreadsheet },
  { href: "/close", label: "Tutup Buku", icon: ClipboardCheck },
];
const SETUP = [
  { href: "/import", label: "Impor Mutasi", icon: Upload },
  { href: "/opening", label: "Saldo Awal", icon: Landmark },
  { href: "/journals/new", label: "Jurnal Penyesuaian", icon: NotebookPen },
  { href: "/rates", label: "Kurs", icon: Coins },
  { href: "/settings", label: "Aturan klasifikasi", icon: ListFilter },
];

export function AppSidebar({ firmName, clients, userEmail, documents = true }: { firmName: string; clients: Client[]; userEmail?: string; documents?: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const { setOpenMobile } = useSidebar();
  const routeClient = clients.find((client) => pathname === `/clients/${client.id}` || pathname.startsWith(`/clients/${client.id}/`));
  const legacyEntity = search.get("entity");
  const scope = search.get("scope") || (routeClient
    ? legacyEntity && routeClient.entities.some((entity) => entity.id === legacyEntity) ? `entity:${legacyEntity}` : `client:${routeClient.id}`
    : "all");
  const selectedClient = routeClient || clients.find((client) => scope === `client:${client.id}` || client.entities.some((entity) => scope === `entity:${entity.id}`));
  function destinationHref(path: string) {
    const params = new URLSearchParams({ scope });
    if (search.get("period")) params.set("period", search.get("period")!);
    return `${path}?${params}`;
  }
  function clientHref(client: Client, path = "") {
    const params = new URLSearchParams();
    if (search.get("period")) params.set("period", search.get("period")!);
    const sameClient = routeClient?.id === client.id || selectedClient?.id === client.id;
    params.set("scope", sameClient ? scope : `client:${client.id}`);
    const entity = client.entities.find((item) => scope === `entity:${item.id}` || (routeClient?.id === client.id && item.id === legacyEntity));
    params.set("entity", entity?.id || "combined");
    return `/clients/${client.id}${path}?${params}`;
  }
  const closeMobile = () => setOpenMobile(false);
  function accountingLinks(items: typeof ACCOUNTING, client: Client) {
    return <SidebarMenuSub>{items.map((item) => <SidebarMenuSubItem key={item.href}><SidebarMenuSubButton isActive={pathname.startsWith(`/clients/${client.id}${item.href}`)} render={<Link href={clientHref(client, item.href)} onClick={closeMobile} />}><item.icon /><span>{item.label}</span></SidebarMenuSubButton></SidebarMenuSubItem>)}</SidebarMenuSub>;
  }
  return (
    <Sidebar>
      <SidebarHeader className="border-b"><Link href={destinationHref("/")} onClick={closeMobile} className="flex items-center gap-2 px-2 py-1.5"><BrandMark /><span className="min-w-0"><span className="block text-sm font-semibold">Buku</span><span className="block truncate text-xs text-muted-foreground">{firmName}</span></span></Link></SidebarHeader>
      <SidebarContent>
        <SidebarGroup><SidebarMenu>{DESTINATIONS.filter((item) => documents || item.href !== "/documents").map((item) => <SidebarMenuItem key={item.href}><SidebarMenuButton isActive={pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`))} render={<Link href={destinationHref(item.href)} onClick={closeMobile} />}><item.icon /><span>{item.label}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroup>
        {selectedClient && <SidebarGroup><SidebarGroupLabel>Akuntansi · {selectedClient.name}</SidebarGroupLabel><SidebarMenu><SidebarMenuItem><SidebarMenuButton isActive={pathname === `/clients/${selectedClient.id}`} render={<Link href={clientHref(selectedClient)} onClick={closeMobile} />}><Building2 /><span>Ringkasan klien</span></SidebarMenuButton>{accountingLinks(ACCOUNTING, selectedClient)}</SidebarMenuItem><Collapsible defaultOpen={SETUP.some((item) => pathname.startsWith(`/clients/${selectedClient.id}${item.href}`))} render={<SidebarMenuItem />}><CollapsibleTrigger render={<SidebarMenuButton className="group/trigger text-muted-foreground" />}><Settings2 /><span>Impor & pengaturan klien</span><ChevronDown className="ml-auto transition-transform group-data-[panel-open]/trigger:rotate-180" /></CollapsibleTrigger><CollapsibleContent>{accountingLinks(SETUP, selectedClient)}</CollapsibleContent></Collapsible></SidebarMenu></SidebarGroup>}
        <SidebarGroup><Collapsible defaultOpen={!selectedClient}><CollapsibleTrigger render={<SidebarGroupLabel render={<button type="button" />} className="group/trigger w-full cursor-pointer hover:bg-sidebar-accent" />}><span>Daftar klien ({clients.length})</span><ChevronDown className="ml-auto transition-transform group-data-[panel-open]/trigger:rotate-180" /></CollapsibleTrigger><CollapsibleContent><SidebarMenu>{clients.map((client) => <SidebarMenuItem key={client.id}><SidebarMenuButton isActive={client.id === selectedClient?.id} render={<Link href={clientHref(client)} onClick={closeMobile} />}><Building2 /><span>{client.name}</span></SidebarMenuButton></SidebarMenuItem>)}<SidebarMenuItem><SidebarMenuButton render={<Link href="/clients/new" onClick={closeMobile} />}><Plus /><span>Tambah klien</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu></CollapsibleContent></Collapsible></SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t"><SidebarMenu><SidebarMenuItem><SidebarMenuButton isActive={pathname === "/settings"} render={<Link href={destinationHref("/settings")} onClick={closeMobile} />}><SlidersHorizontal /><span>Pengaturan</span></SidebarMenuButton></SidebarMenuItem><SidebarMenuItem><form action={signOutAction}><SidebarMenuButton type="submit"><LogOut /><span>Keluar</span></SidebarMenuButton></form></SidebarMenuItem></SidebarMenu>{userEmail && <p className="truncate px-2 text-xs text-muted-foreground">{userEmail}</p>}</SidebarFooter>
    </Sidebar>
  );
}

export function MobileTrigger() { return <SidebarTrigger className="md:hidden" aria-label="Buka navigasi" />; }
