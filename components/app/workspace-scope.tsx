"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Scope = {
  key: string;
  label: string;
  period: string;
  periodLabel: string;
  clients: { id: string; name: string; entities: { id: string; name: string }[] }[];
};

/** One explicit scope for every top-level workspace destination. */
export function WorkspaceScopeBar({ scope }: { scope: Scope }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.has("scope") && searchParams.has("period")) return;
    const canonical = new URLSearchParams(searchParams.toString());
    canonical.set("scope", scope.key);
    canonical.set("period", scope.period);
    router.replace(`${pathname}?${canonical}`, { scroll: false });
  }, [pathname, router, scope.key, scope.period, searchParams]);
  const options = [
    { value: "all", label: "Semua klien" },
    ...scope.clients.flatMap((client) => [
      { value: `client:${client.id}`, label: `Grup / klien · ${client.name}` },
      ...client.entities.map((entity) => ({ value: `entity:${entity.id}`, label: `Perusahaan · ${entity.name}` })),
    ]),
  ];
  function update(key: "scope" | "period", value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("scope", scope.key);
    params.set("period", scope.period);
    params.set(key, value);
    params.delete("entity");
    router.push(`${pathname}?${params}`);
  }
  return (
    <section aria-label="Konteks ruang kerja" className="grid min-w-0 gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
      <div className="min-w-0 space-y-1.5">
        <label id="workspace-scope-label" className="block text-xs font-medium text-muted-foreground">Klien atau perusahaan</label>
        <Select items={options} value={scope.key} onValueChange={(value) => value && update("scope", value)}>
          <SelectTrigger aria-labelledby="workspace-scope-label" className="w-full min-w-0 bg-card [&_[data-slot=select-value]]:truncate"><SelectValue /></SelectTrigger>
          <SelectContent className="max-w-[calc(100vw-2rem)]">
            {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-0 space-y-1.5">
        <label htmlFor="workspace-period" className="block text-xs font-medium text-muted-foreground">Periode</label>
        <input id="workspace-period" aria-label="Periode" type="month" value={scope.period} min="1900-01" max="2199-12" onChange={(event) => /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(event.target.value) && update("period", event.target.value)} className="h-8 w-full min-w-0 rounded-lg border bg-card px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
      </div>
    </section>
  );
}
