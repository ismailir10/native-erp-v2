"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, Home, Plus } from "lucide-react";
import { Command as CommandRoot, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { clientSections, parseClientPath, parseRecents, pushRecent, resolveScope, searchScore, switchTarget } from "@/lib/nav";

export type SwitcherClient = { id: string; name: string; entities: { id: string; name: string }[]; modules: string[] };

const RECENTS_KEY = "buku:recent-clients";
const RECENTS_FROM = 6; // a firm with up to six clients sees them all at once
type Ctx = { open: () => void; clients: SwitcherClient[] };
const SwitcherContext = createContext<Ctx>({ open: () => {}, clients: [] });
export const useClientSwitcher = () => useContext(SwitcherContext);

function readRecents(known: Set<string>) {
  try { return parseRecents(window.localStorage.getItem(RECENTS_KEY), known); } catch { return []; }
}
function writeRecents(list: string[]) {
  try { window.localStorage.setItem(RECENTS_KEY, JSON.stringify(list)); } catch { /* private window or blocked storage: recents are a convenience */ }
}

/** "⌘ K" on a Mac, "Ctrl K" elsewhere. The server and the first client render agree ("Ctrl K"); a Mac swaps after mount. */
export function ShortcutKbd({ className }: { className?: string }) {
  const mac = useSyncExternalStore(() => () => {}, () => /mac|iphone|ipad/i.test(navigator.platform), () => false);
  return <Kbd className={className}>{mac ? "⌘ K" : "Ctrl K"}</Kbd>;
}

/** The client switcher: one palette for the whole app, opened with ⌘K / Ctrl+K or from any trigger (sidebar, the bar above a client page). */
export function ClientSwitcherProvider({ clients, children }: { clients: SwitcherClient[]; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [isOpen, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  const known = useMemo(() => new Set(clients.map((c) => c.id)), [clients]);
  const { selectedClient: current, routeClient, scope } = resolveScope(clients, pathname, { scope: search.get("scope"), entity: search.get("entity") });
  const period = search.get("period");

  const open = useCallback(() => { setQuery(""); setRecents(readRecents(known)); setOpen(true); }, [known]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      if (isOpen) setOpen(false); else open();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, open]);

  // Every client page opened, by any route (sidebar, task list, a link), counts as "recent".
  const routeClientId = routeClient?.id;
  useEffect(() => { if (routeClientId) writeRecents(pushRecent(readRecents(known), routeClientId)); }, [routeClientId, known]);

  const go = (href: string) => { setOpen(false); router.push(href); };
  const target = (client: SwitcherClient) => switchTarget(pathname, client, { period, scope });
  // The client already open goes last, so the highlighted row (and Enter) is always *another* client; ping-ponging between two is Ctrl K, Enter.
  const sorted = [...clients].sort((a, b) => Number(a.id === current?.id) - Number(b.id === current?.id) || a.name.localeCompare(b.name, "id"));
  // Recents only earn their place in a long list. They move out of "Klien" instead of repeating there, and a search shows one flat list.
  const recentClients = recents.map((id) => clients.find((c) => c.id === id)).filter((c): c is SwitcherClient => Boolean(c) && c?.id !== current?.id);
  const showRecents = clients.length > RECENTS_FROM && !query.trim() && recentClients.length > 0;
  const rest = showRecents ? sorted.filter((c) => !recentClients.some((r) => r.id === c.id)) : sorted;

  function row(client: SwitcherClient, prefix: string) {
    const isCurrent = client.id === current?.id;
    const companies = client.entities.map((e) => e.name).filter((n) => n !== client.name);
    return (
      <CommandItem key={`${prefix}${client.id}`} value={`${prefix}${client.id}`} keywords={[client.name, ...client.entities.map((e) => e.name)]} onSelect={() => go(isCurrent ? currentHref(client) : target(client).href)}>
        <Building2 className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{client.name}</span>
          {companies.length > 0 && <span className="block truncate text-xs text-muted-foreground">{companies.join(" · ")}</span>}
        </span>
        <CommandShortcut className="shrink-0 tracking-normal">{isCurrent ? "Sekarang" : target(client).label}</CommandShortcut>
      </CommandItem>
    );
  }
  // The client already open: the same page again (no jump), carrying its own scope.
  function currentHref(client: SwitcherClient) {
    return routeClient ? `${pathname}${search.toString() ? `?${search}` : ""}` : target(client).href;
  }
  function pageHref(href: string) {
    const params = new URLSearchParams();
    if (period) params.set("period", period);
    params.set("scope", scope);
    const entity = search.get("entity");
    if (entity && routeClient) params.set("entity", entity);
    return `/clients/${current!.id}${href}?${params}`;
  }
  const here = parseClientPath(pathname);

  return (
    <SwitcherContext.Provider value={{ open, clients }}>
      {children}
      <CommandDialog open={isOpen} onOpenChange={setOpen} title="Cari klien" description="Ketik nama klien atau perusahaan, lalu Enter untuk membukanya." className="sm:max-w-lg">
        <CommandSearch query={query} setQuery={setQuery} placeholder={current ? "Cari klien atau halaman…" : "Cari klien…"}>
          {showRecents && (
            <CommandGroup heading="Terakhir dibuka">{recentClients.map((c) => row(c, "recent:"))}</CommandGroup>
          )}
          <CommandGroup heading={showRecents ? "Klien lainnya" : "Klien"}>{rest.map((c) => row(c, "client:"))}</CommandGroup>
          {current && (
            <CommandGroup heading={`Halaman · ${current.name}`}>
              {clientSections(current.modules).map((s) => (
                <CommandItem key={s.href} value={`page:${s.href}`} keywords={[s.label, "halaman"]} onSelect={() => go(pageHref(s.href))}>
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  {here && here.rest === s.href && <CommandShortcut className="tracking-normal">Sekarang</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandGroup heading="Lainnya">
            <CommandItem value="other:beranda" keywords={["Beranda", "semua klien"]} onSelect={() => go(period ? `/?scope=all&period=${period}` : "/?scope=all")}><Home className="size-4 text-muted-foreground" />Beranda · semua klien</CommandItem>
            <CommandItem value="other:tambah" keywords={["Tambah klien", "klien baru"]} onSelect={() => go("/clients/new")}><Plus className="size-4 text-muted-foreground" />Tambah klien</CommandItem>
          </CommandGroup>
        </CommandSearch>
      </CommandDialog>
    </SwitcherContext.Provider>
  );
}

/** cmdk with our own matching (accent- and case-insensitive, every word must match) and the empty state. */
function CommandSearch({ query, setQuery, placeholder, children }: { query: string; setQuery: (q: string) => void; placeholder: string; children: React.ReactNode }) {
  return (
    <CommandRoot filter={(_value, search, keywords) => searchScore((keywords ?? []).join(" "), search)}>
      <CommandInput value={query} onValueChange={setQuery} placeholder={placeholder} aria-label="Cari klien" />
      <CommandList>
        <CommandEmpty>
          <span className="block px-4 text-muted-foreground">Tidak ada klien atau halaman “{query.trim()}”. Coba nama perusahaannya, atau Tambah klien.</span>
        </CommandEmpty>
        {children}
      </CommandList>
    </CommandRoot>
  );
}
