"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Option = { value: string; label: string };

/** A shadcn Select for a plain list of options; `""` is a valid option value (e.g. "Semua …"). */
export function SimpleSelect({ value, onChange, options, placeholder, disabled, className, id, label }: { value: string; onChange: (value: string) => void; options: Option[]; placeholder?: string; disabled?: boolean; className?: string; id?: string; label: string }) {
  return (
    <Select value={value} onValueChange={(next) => onChange((next as string | null) ?? "")} disabled={disabled}>
      <SelectTrigger id={id} aria-label={label} className={cn("w-full min-w-0 bg-card [&_[data-slot=select-value]]:truncate", className)}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent className="max-w-[calc(100vw-2rem)]">
        {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
