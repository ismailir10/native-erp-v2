import { BrandMark } from "@/components/app/brand-mark";
import { DotGrid } from "@/components/motion/dot-grid";
import { PublicHeader, PublicFooter } from "@/components/app/public-site-chrome";

/** One Buku frame for login, links, trial requests, closed access, and public error pages. */
export function PublicShell({ title, description, children, footer, aside, contact, dotGrid = false }: { title: string; description: string; children: React.ReactNode; footer?: React.ReactNode; aside?: React.ReactNode; contact?: React.ReactNode; dotGrid?: boolean }) {
  const card = <section className="page-settle relative w-full max-w-md rounded-2xl border bg-card p-6 sm:p-8" aria-labelledby="public-title">
    <div className="mb-8 flex items-center gap-2 text-xl font-semibold"><BrandMark className="size-8 text-base" />Buku</div>
    <h1 id="public-title" className="display text-3xl">{title}</h1>
    <p className="mb-6 mt-2 text-sm text-muted-foreground">{description}</p>
    {children}
    {footer && <div className="mt-6 border-t pt-5 text-xs text-muted-foreground">{footer}</div>}
  </section>;
  return <div className="flex min-h-dvh flex-col"><a href="#public-main" className="sr-only z-50 rounded-lg bg-card p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Lewati navigasi</a><PublicHeader /><main id="public-main" tabIndex={-1} className="relative flex flex-1 items-center justify-center bg-background px-5 py-12">
    {dotGrid && <DotGrid />}
    {aside ? <div className="relative flex w-full max-w-5xl flex-col items-center gap-10 lg:flex-row-reverse lg:items-center lg:justify-between">
      {card}<div className="w-full max-w-md lg:max-w-sm">{aside}</div>
    </div> : card}
  </main><PublicFooter contact={contact} /></div>;
}
