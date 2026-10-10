import type { Metadata } from "next";
import { LegalPage } from "@/components/app/legal-page";
import { PUBLIC_TERMS } from "@/lib/public-legal";

export const metadata: Metadata = {
  title: "Syarat penggunaan",
  description: "Draf syarat penggunaan Buku: permintaan uji coba, akses pembukuan, tanggung jawab pengguna dan dukungan.",
  alternates: { canonical: "/syarat" },
  openGraph: {
    title: "Syarat penggunaan · Buku",
    description: "Draf syarat penggunaan Buku, termasuk akses uji coba dan dukungan.",
    url: "/syarat",
    siteName: "Buku",
    locale: "id_ID",
    type: "website",
  },
};
export const dynamic = "force-dynamic";

export default function TermsPage() {
  return <LegalPage document={PUBLIC_TERMS} />;
}
