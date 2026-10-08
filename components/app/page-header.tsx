import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { CheckDraw } from "@/components/motion/check-draw";

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="display text-3xl text-balance md:text-4xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
    </div>
  );
}

/** Every page states the one thing to do next, with at most one button. */
export function NextStep({ children, href, cta, tone = "info" }: { children: React.ReactNode; href?: string; cta?: string; tone?: "info" | "done" }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-4 py-3 text-sm",
        tone === "done" ? "border border-pass/20 bg-pass-subtle text-pass" : "bg-primary-subtle text-foreground",
      )}
      data-testid="next-step"
    >
      {tone === "done" ? <CheckDraw /> : <span className="size-2 shrink-0 rounded-full bg-brand" aria-hidden />}
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
    <div className={cn("rounded-xl border bg-card p-4", className)}>
      <div className="eyebrow">{label}</div>
      <div className="num display mt-1 text-3xl">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
