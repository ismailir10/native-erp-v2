import { CircleCheck, CircleAlert, CircleX } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ControlStatus } from "@/lib/controls";

const MAP: Record<ControlStatus, { label: string; icon: typeof CircleCheck; cls: string }> = {
  PASS: { label: "Lolos", icon: CircleCheck, cls: "bg-pass-subtle text-pass" },
  REVIEW: { label: "Perlu dicek", icon: CircleAlert, cls: "bg-review-subtle text-review" },
  FAIL: { label: "Gagal", icon: CircleX, cls: "bg-fail-subtle text-fail" },
};

/** Status always carries icon + label — never colour alone. */
export function StatusPill({ status, label, className }: { status: ControlStatus; label?: string; className?: string }) {
  const s = MAP[status];
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", s.cls, className)}>
      <Icon className="size-3.5" aria-hidden />
      {label ?? s.label}
    </span>
  );
}

export function MethodBadge({ method }: { method: string }) {
  const labels: Record<string, [string, string]> = {
    TRANSFER: ["Transfer", "bg-secondary text-secondary-foreground"],
    RULE: ["Aturan", "bg-secondary text-secondary-foreground"],
    MEMORY: ["Memori", "bg-secondary text-secondary-foreground"],
    AI: ["AI", "bg-primary-subtle text-primary"],
    HEURISTIC: ["Tebakan", "bg-review-subtle text-review"],
    MANUAL: ["Manual", "bg-muted text-muted-foreground"],
  };
  const [label, cls] = labels[method] ?? [method, "bg-muted"];
  return <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium", cls)}>{label}</span>;
}
