import { BrandMark } from "@/components/app/brand-mark";

/** Shared frame for the public pages: login, forgot password, set password. */
export function AuthShell({ title, description, children, footer }: { title: string; description: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return <main className="flex min-h-dvh items-center justify-center bg-sidebar px-5 py-12">
    <section className="w-full max-w-md rounded-lg border bg-card p-6 sm:p-8" aria-labelledby="auth-title">
      <div className="mb-8 flex items-center gap-2 text-xl font-semibold"><BrandMark className="size-8 text-base" />Buku</div>
      <h1 id="auth-title" className="text-2xl font-semibold">{title}</h1>
      <p className="mb-6 mt-2 text-sm text-muted-foreground">{description}</p>
      {children}
      {footer && <p className="mt-6 border-t pt-5 text-xs text-muted-foreground">{footer}</p>}
    </section>
  </main>;
}
