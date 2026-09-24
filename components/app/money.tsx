import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";

/** Right-aligned tabular amount in `currency` (default Rupiah). Negatives in accounting parentheses. Zero shows as "–". */
export function Money({ value, className, strong, muted, currency = "IDR" }: { value: bigint; className?: string; strong?: boolean; muted?: boolean; currency?: string }) {
  return (
    <span className={cn("num whitespace-nowrap", strong && "font-semibold", muted && "text-muted-foreground", value < 0n && "text-foreground", className)}>
      {value === 0n ? "–" : formatMoney(value, currency, { accounting: true, bare: true })}
    </span>
  );
}
