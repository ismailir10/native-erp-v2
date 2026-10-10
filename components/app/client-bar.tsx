"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight, ChevronsUpDown, Home } from "lucide-react";
import { useClientSwitcher } from "@/components/app/client-switcher";
import { parseClientPath, sectionOf, upQuery } from "@/lib/nav";

/**
 * Where you are, on every client page: `Semua klien › PT Contoh ▾`, and `› Buku Besar` when the page is under that section. The name is the client switcher (the sidebar is closed on a
 * phone, so this is the way to change client there); the section is a link when the page is under it (an account, an asset, an imported
 * file), which is the way up. Renders nothing for a client this firm doesn't have: the page itself says not found.
 */
export function ClientBar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const { clients, open } = useClientSwitcher();
  const here = parseClientPath(pathname);
  const client = here && clients.find((c) => c.id === here.clientId);
  if (!here || !client) return null;
  const found = sectionOf(here.rest);
  const carry = new URLSearchParams();
  for (const key of ["period", "scope", "entity"]) if (search.get(key)) carry.set(key, search.get(key)!);
  for (const [key, value] of Object.entries(upQuery(here.rest))) carry.set(key, value);
  const params = carry.toString() ? `?${carry}` : "";
  // The trail names the way *up*. On the section's own page the title below already says it, so it isn't repeated.
  const section = found?.deeper && found.section.href ? found.section : null;
  const sep = <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />;
  const nameIsCurrent = found?.section.href === "";
  return (
    <nav aria-label="Posisi" data-testid="client-bar" className="mb-4 flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
      <Link href={`/?scope=all${search.get("period") ? `&period=${search.get("period")}` : ""}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-muted hover:text-foreground">
        <Home className="size-3.5" aria-hidden /><span className="sr-only sm:not-sr-only">Semua klien</span>
      </Link>
      {sep}
      <button type="button" onClick={open} aria-haspopup="dialog" title={`${client.name} · ganti klien`} aria-current={nameIsCurrent ? "page" : undefined} className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
        <span className="truncate">{client.name}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      {section && (
        <>
          {sep}
          <Link href={`/clients/${client.id}${section.href}${params}`} className="shrink-0 rounded-md px-1.5 py-1 hover:bg-muted hover:text-foreground">{section.label}</Link>
        </>
      )}
    </nav>
  );
}
