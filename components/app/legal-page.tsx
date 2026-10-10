import Link from "next/link";
import { PublicSiteFrame } from "@/components/app/public-site-frame";
import { PublicContact } from "@/components/app/public-contact";
import { PUBLIC_LEGAL_DRAFT, PUBLIC_LEGAL_UPDATED, type PublicLegalDocument } from "@/lib/public-legal";

export function LegalPage({ document }: { document: PublicLegalDocument }) {
  return <PublicSiteFrame>
    <article className="page-settle mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-16" aria-labelledby="legal-title">
      <div className="mb-8 rounded-xl border border-review/30 bg-review-subtle p-4 text-sm leading-relaxed" role="note">
        <p className="font-medium text-review">Draf ketentuan</p>
        <p className="mt-1">{PUBLIC_LEGAL_DRAFT}</p>
      </div>
      <h1 id="legal-title" className="display text-4xl sm:text-5xl">{document.title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">Diperbarui <time dateTime={PUBLIC_LEGAL_UPDATED.iso}>{PUBLIC_LEGAL_UPDATED.label}</time></p>
      <p className="mt-6 text-lg leading-relaxed text-muted-foreground">{document.introduction}</p>
      <div className="mt-10 space-y-9">
        {document.sections.map((section) => <section key={section.id} aria-labelledby={section.id}>
          <h2 id={section.id} className="text-xl font-medium">{section.title}</h2>
          <div className="mt-3 space-y-3 text-base leading-7">
            {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </div>
        </section>)}
        <section aria-labelledby="kontak-pengelola">
          <h2 id="kontak-pengelola" className="text-xl font-medium">Hubungi pengelola</h2>
          <p className="mt-3 text-base leading-7">Untuk pertanyaan tentang uji coba, dukungan, atau permintaan terkait data: <PublicContact />.</p>
        </section>
      </div>
      <div className="mt-10 border-t pt-6 text-sm"><Link href={document.relatedHref} className="drill">{document.relatedLabel}</Link></div>
    </article>
  </PublicSiteFrame>;
}
