import { cn } from "@/lib/utils";
import { formatRupiah } from "@/lib/money";

/** Right-aligned tabular Rupiah. Negatives in accounting parentheses. Zero shows as "–". */
export function Money({ value, className, strong, muted }: { value: bigint; className?: string; strong?: boolean; muted?: boolean }) {
  return (
    <span className={cn("num whitespace-nowrap", strong && "font-semibold", muted && "text-muted-foreground", value < 0n && "text-foreground", className)}>
      {value === 0n ? "–" : formatRupiah(value, { accounting: true, bare: true })}
    </span>
  );
}
