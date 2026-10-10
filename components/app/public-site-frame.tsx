import { PublicHeader, PublicFooter } from "@/components/app/public-site-chrome";
import { PublicContact } from "@/components/app/public-contact";

export function PublicSiteFrame({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh flex-col">
    <a href="#public-main" className="sr-only z-50 rounded-lg bg-card p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Lewati navigasi</a>
    <PublicHeader />
    <main id="public-main" tabIndex={-1} className="flex-1">{children}</main>
    <PublicFooter contact={<PublicContact />} />
  </div>;
}
