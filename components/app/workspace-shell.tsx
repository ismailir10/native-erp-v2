"use client";

import type { ReactNode } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar, MobileTrigger } from "@/components/app/app-sidebar";
import { AccessProvider, type AccessView } from "@/components/app/access-context";
import { SupportBar } from "@/components/app/support-bar";
import { NavigationProgress } from "@/components/app/navigation-progress";
import { ClientBar } from "@/components/app/client-bar";
import { ClientSwitcherProvider, type SwitcherClient } from "@/components/app/client-switcher";

type WorkspaceShellProps = {
  firmName: string;
  clients: SwitcherClient[];
  user: { name: string; role: string };
  documents: boolean;
  company: boolean;
  support: { firmName: string; memberName: string; expiresAt: string } | null;
  access: AccessView;
  banner: ReactNode;
  children: ReactNode;
};

export function WorkspaceShell({ firmName, clients, user, documents, company, support, access, banner, children }: WorkspaceShellProps) {
  const shell = (
    <SidebarProvider>
      <NavigationProgress />
      <a href="#workspace-main" className="sr-only z-50 rounded-lg bg-card p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Lewati navigasi</a>
      <AppSidebar firmName={firmName} clients={clients} user={user} documents={documents} company={company} />
      <SidebarInset className="min-w-0 bg-background">
        {support && <SupportBar firmName={support.firmName} memberName={support.memberName} expiresAt={support.expiresAt} />}
        <div className="flex items-center gap-2 border-b bg-card px-4 py-2 md:hidden"><MobileTrigger /><span className="text-sm font-semibold">Buku</span></div>
        <div id="workspace-main" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">{banner}{!company && <ClientBar />}<AccessProvider value={access}>{children}</AccessProvider></div>
      </SidebarInset>
    </SidebarProvider>
  );
  return company ? shell : <ClientSwitcherProvider clients={clients}>{shell}</ClientSwitcherProvider>;
}
