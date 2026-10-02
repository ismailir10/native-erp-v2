import { BrandMark } from "@/components/app/brand-mark";
import { DotGrid } from "@/components/motion/dot-grid";

/** Shared frame for the public pages: login, forgot password, set password. `aside` sits beside the card (below it on phones). */
export function AuthShell({ title, description, children, footer, aside }: { title: string; description: string; children: React.ReactNode; footer?: React.ReactNode; aside?: React.ReactNode }) {
  const card = (
    <section className="page-settle relative w-full max-w-md rounded-lg border bg-card p-6 sm:p-8" aria-labelledby="auth-title">
      <div className="mb-8 flex items-center gap-2 text-xl font-semibold"><BrandMark className="size-8 text-base" />Buku</div>
      <h1 id="auth-title" className="text-2xl font-semibold">{title}</h1>
      <p className="mb-6 mt-2 text-sm text-muted-foreground">{description}</p>
      {children}
      {footer && <p className="mt-6 border-t pt-5 text-xs text-muted-foreground">{footer}</p>}
    </section>
  );
  return <main className="relative flex min-h-dvh items-center justify-center bg-background px-5 py-12">
    <DotGrid />
    {aside ? (
      <div className="relative flex w-full max-w-5xl flex-col items-center gap-10 lg:flex-row-reverse lg:items-center lg:justify-between">
        {card}
        <div className="w-full max-w-md lg:max-w-sm">{aside}</div>
      </div>
    ) : card}
  </main>;
}
