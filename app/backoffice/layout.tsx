import type { Metadata } from "next";
import Link from "next/link";
import { LogOut } from "lucide-react";
import { BrandMark } from "@/components/app/brand-mark";
import { Button } from "@/components/ui/button";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { signOutAction } from "@/app/login/actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { template: "%s · Backoffice Buku", default: "Backoffice Buku" }, robots: { index: false, follow: false } };

const NAV = [{ href: "/backoffice", label: "Organisasi" }, { href: "/backoffice/requests", label: "Permintaan" }, { href: "/backoffice/settings", label: "Pengaturan AI" }, { href: "/backoffice/keamanan", label: "Keamanan" }];

/** Buku's own backoffice (ADR 0017 §2): only active Buku admins; everyone else gets a 404. No organisation's sidebar or books here. */
export default async function BackofficeLayout({ children }: { children: React.ReactNode }) {
  const admin = await requirePlatformAdmin();
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 md:px-8">
          <Link href="/backoffice" className="flex items-center gap-2 font-semibold"><BrandMark />Buku<span className="font-normal text-muted-foreground">Backoffice</span></Link>
          <nav aria-label="Backoffice" className="order-last -mx-3 flex w-full gap-1 overflow-x-auto md:order-none md:mx-0 md:w-auto md:flex-1">
            {NAV.map((item) => <Link key={item.href} href={item.href} className="shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-muted">{item.label}</Link>)}
          </nav>
          <span className="hidden truncate text-sm text-muted-foreground md:inline">{admin.name}</span>
          <form action={signOutAction} className="ml-auto md:ml-0"><Button type="submit" variant="ghost" size="sm"><LogOut />Keluar</Button></form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
