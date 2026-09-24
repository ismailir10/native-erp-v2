"use client";

import { useMemo } from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import { ChevronDownIcon } from "lucide-react";
import { ComboboxCollection, ComboboxContent, ComboboxEmpty, ComboboxGroup, ComboboxItem, ComboboxLabel, ComboboxList } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";

export type AccountOption = { code: string; name: string; group: string };
type Item = { value: string; label: string };
type Group = { value: string; items: Item[] };

/**
 * Searchable account select: looks like a Select, opens a list with a search box on top. Type a code ("6150") or part
 * of a name ("pemasaran"). `extra` items (e.g. "+ Buat akun baru") come first, outside any group.
 */
export function AccountPicker({
  value,
  onChange,
  options,
  extra = [],
  ariaLabel,
  placeholder = "Pilih akun",
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: AccountOption[];
  extra?: Item[];
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const groups = useMemo<Group[]>(() => {
    const byGroup = new Map<string, Item[]>();
    for (const o of options) byGroup.set(o.group, [...(byGroup.get(o.group) ?? []), { value: o.code, label: `${o.code} ${o.name}` }]);
    return [...(extra.length ? [{ value: "", items: extra }] : []), ...[...byGroup].map(([g, items]) => ({ value: g, items }))];
  }, [options, extra]);
  const selected = useMemo(() => groups.flatMap((g) => g.items).find((i) => i.value === value) ?? null, [groups, value]);

  return (
    <ComboboxPrimitive.Root
      items={groups}
      value={selected}
      onValueChange={(v: Item | null) => v && onChange(v.value)}
      itemToStringLabel={(i: Item) => i.label}
      filter={(item: Item, query) => extra.some((i) => i.value === item.value) || item.label.toLocaleLowerCase("id").includes(query.trim().toLocaleLowerCase("id"))}
      isItemEqualToValue={(a: Item, b: Item) => a.value === b.value}
      disabled={disabled}
    >
      <ComboboxPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          "flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-left text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <span className={cn("line-clamp-1", !selected && "text-muted-foreground")}>{selected?.label ?? placeholder}</span>
        <ChevronDownIcon className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
      </ComboboxPrimitive.Trigger>
      <ComboboxContent className="min-w-72">
        <ComboboxPrimitive.Input
          aria-label={`Cari ${ariaLabel.charAt(0).toLowerCase()}${ariaLabel.slice(1)}`}
          placeholder="Cari kode atau nama akun"
          className="m-1 h-8 w-[calc(100%-0.5rem)] rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
        />
        <ComboboxEmpty>Tidak ada akun yang cocok.</ComboboxEmpty>
        <ComboboxList>
          {(group: Group) => (
            <ComboboxGroup key={group.value || "_extra"} items={group.items}>
              {group.value && <ComboboxLabel>{group.value}</ComboboxLabel>}
              <ComboboxCollection>
                {(item: Item) => (
                  <ComboboxItem key={item.value} value={item}>
                    {item.label}
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </ComboboxPrimitive.Root>
  );
}
