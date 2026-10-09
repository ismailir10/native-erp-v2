"use client";

import { useMemo, useRef, useState } from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import { ChevronDownIcon } from "lucide-react";
import { ComboboxCollection, ComboboxContent, ComboboxEmpty, ComboboxGroup, ComboboxItem, ComboboxLabel, ComboboxList } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";

export type AccountOption = { code: string; name: string; group: string };
/** How an option reads in the list and on the trigger: "6150 Beban pemasaran" for accounts. */
const codeAndName = (o: AccountOption) => `${o.code} ${o.name}`;
type Item = { value: string; label: string };
type Group = { value: string; items: Item[] };

/**
 * Searchable select (accounts; banks through `BankPicker`): looks like a Select, opens a list with a search box on top. Type a code ("6150") or part
 * of a name ("pemasaran"). `extra` items (e.g. "+ Buat akun baru") come first, outside any group. The first match is highlighted,
 * so Enter picks it; keys typed on the closed trigger open the list with them already in the search (none lost while it opens, none
 * committed as the value), and Enter on a match chooses it and leaves the list closed.
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
  searchPlaceholder = "Cari kode atau nama akun",
  emptyText = "Tidak ada akun yang cocok.",
  labelOf = codeAndName,
}: {
  value: string;
  onChange: (value: string) => void;
  options: AccountOption[];
  extra?: Item[];
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  labelOf?: (o: AccountOption) => string;
}) {
  const groups = useMemo<Group[]>(() => {
    const byGroup = new Map<string, Item[]>();
    for (const o of options) byGroup.set(o.group, [...(byGroup.get(o.group) ?? []), { value: o.code, label: labelOf(o) }]);
    return [...(extra.length ? [{ value: "", items: extra }] : []), ...[...byGroup].map(([g, items]) => ({ value: g, items }))];
  }, [options, extra, labelOf]);
  const selected = useMemo(() => groups.flatMap((g) => g.items).find((i) => i.value === value) ?? null, [groups, value]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const closedAt = useRef(0);

  return (
    <ComboboxPrimitive.Root
      items={groups}
      open={open}
      onOpenChange={(next: boolean, details?: { event?: Event }) => {
        // Choosing with Enter closes the list and returns focus to the trigger, where the same key press "clicks" it open again.
        // Only that keyboard echo is ignored: a mouse or touch reopen, however quick, opens.
        const pointer = !!details?.event && /^(mouse|pointer|touch)/.test(details.event.type);
        if (next && !pointer && Date.now() - closedAt.current < 250) return;
        setOpen(next);
        if (!next) {
          setQuery("");
          closedAt.current = Date.now();
        }
      }}
      inputValue={query}
      onInputValueChange={(v: string) => setQuery(v)}
      autoHighlight
      value={selected}
      onValueChange={(v: Item | null) => v && onChange(v.value)}
      itemToStringLabel={(i: Item) => i.label}
      filter={(item: Item, query) => extra.some((i) => i.value === item.value) || item.label.toLocaleLowerCase("id").includes(query.trim().toLocaleLowerCase("id"))}
      isItemEqualToValue={(a: Item, b: Item) => a.value === b.value}
      disabled={disabled}
    >
      <ComboboxPrimitive.Trigger
        aria-label={ariaLabel}
        onKeyDown={(e) => {
          if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
          // Space opens a closed list like any button; while it is open it is part of the search ("jasa prof").
          if (e.key === " " && !open) return;
          e.preventDefault();
          // base-ui's closed-trigger typeahead would commit the first match as the value ("4" → 4100): typing here searches instead.
          (e as unknown as { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
          setQuery((q) => (open ? q : "") + e.key);
          setOpen(true);
        }}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-card py-2 pr-2 pl-3 text-left text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <span className={cn("line-clamp-1", !selected && "text-muted-foreground")}>{selected?.label ?? placeholder}</span>
        <ChevronDownIcon className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
      </ComboboxPrimitive.Trigger>
      <ComboboxContent className="min-w-72">
        <ComboboxPrimitive.Input
          aria-label={`Cari ${ariaLabel.charAt(0).toLowerCase()}${ariaLabel.slice(1)}`}
          placeholder={searchPlaceholder}
          className="m-1 h-8 w-[calc(100%-0.5rem)] rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring"
        />
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
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
