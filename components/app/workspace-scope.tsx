"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatPeriod } from "@/lib/format";

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
  const periods = monthOptions(scope.period);
  function update(key: "scope" | "period", value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("scope", scope.key);
    params.set("period", scope.period);
    params.set(key, value);
    params.delete("entity");
    router.push(`${pathname}?${params}`);
  }
  return (
    <div role="group" aria-label="Konteks ruang kerja" className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
      <Select items={options} value={scope.key} onValueChange={(value) => value && update("scope", value)}>
        <SelectTrigger aria-label="Klien atau perusahaan" className="w-full min-w-0 bg-card sm:w-64 [&_[data-slot=select-value]]:truncate"><SelectValue /></SelectTrigger>
        <SelectContent className="max-w-[calc(100vw-2rem)]">
          {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select items={periods} value={scope.period} onValueChange={(value) => value && update("period", value)}>
        <SelectTrigger aria-label="Periode" className="w-full min-w-40 bg-card sm:w-auto"><SelectValue /></SelectTrigger>
        <SelectContent>
          {periods.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Last 24 months up to this month, always including the selected period. */
function monthOptions(selected: string) {
  const now = new Date();
  const current = now.getFullYear() * 12 + now.getMonth();
  const [year, month] = selected.split("-").map(Number);
  const chosen = year * 12 + month - 1;
  const last = Math.max(current, chosen);
  const first = Math.min(last - 23, chosen);
  const out: { value: string; label: string }[] = [];
  for (let index = last; index >= first; index--) {
    const y = Math.floor(index / 12), m = (index % 12) + 1;
    out.push({ value: `${y}-${String(m).padStart(2, "0")}`, label: formatPeriod(y, m) });
  }
  return out;
}
