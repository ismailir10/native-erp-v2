import Link from "next/link";
import { ArrowRight, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Every page states the one thing to do next, with at most one button. */
export function NextStep({ children, href, cta, tone = "info" }: { children: React.ReactNode; href?: string; cta?: string; tone?: "info" | "done" }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3 text-sm",
        tone === "done" ? "border-pass/20 bg-pass-subtle text-pass" : "border-primary/15 bg-primary-subtle text-foreground",
      )}
      data-testid="next-step"
    >
      {tone === "done" && <CircleCheck className="size-4 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1 font-medium">{children}</div>
      {href && cta && (
        <Link href={href} className={buttonVariants({ size: "sm" })}>
          {cta} <ArrowRight className="size-3.5" />
        </Link>
      )}
    </div>
  );
}

export function Stat({ label, value, hint, className }: { label: string; value: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border bg-card p-4 shadow-xs", className)}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="num mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
