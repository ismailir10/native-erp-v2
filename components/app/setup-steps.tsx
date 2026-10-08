import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SetupProgress } from "@/lib/setup-progress";

/** The four first-run steps in order (lib/setup-progress.ts): where you are, what is done, one click to any of them. */
export function SetupSteps({ progress, className }: { progress: SetupProgress; className?: string }) {
  if (!progress.current) return null;
  const at = progress.steps.findIndex((s) => s.key === progress.current) + 1;
  return (
    <nav aria-label="Langkah persiapan" data-testid="setup-steps" className={className}>
      <div className="eyebrow mb-2">Langkah {at} dari {progress.steps.length}</div>
      <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
        {progress.steps.map((s, i) => (
          <li key={s.key} className="bg-card">
            <Link
              href={s.href}
              aria-current={s.state === "current" ? "step" : undefined}
              className={cn("flex h-full items-start gap-3 px-3 py-2.5 text-sm hover:bg-muted", s.state === "current" && "bg-primary-subtle")}
            >
              <span className={cn("num mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-xs", s.state === "done" ? "border-pass/40 bg-pass-subtle text-pass" : s.state === "current" ? "border-primary bg-brand text-white" : "text-muted-foreground")}>
                {s.state === "done" ? <Check className="size-3.5" aria-label="Selesai" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className={cn("block font-medium", s.state === "todo" && "text-muted-foreground")}>{s.label}</span>
                {s.detail && <span className="block truncate text-xs text-muted-foreground">{s.detail}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
