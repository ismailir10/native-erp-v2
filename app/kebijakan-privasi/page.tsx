import type { Metadata } from "next";
import { LegalPage } from "@/components/app/legal-page";
import { PUBLIC_PRIVACY } from "@/lib/public-legal";

export const metadata: Metadata = {
  title: "Kebijakan privasi",
  description: "Draf kebijakan privasi Buku: data permintaan uji coba, pembukuan, dukungan, pemrosesan AI dan hak data pribadi.",
  alternates: { canonical: "/kebijakan-privasi" },
  openGraph: {
    title: "Kebijakan privasi · Buku",
    description: "Draf kebijakan privasi Buku, termasuk tujuan pemrosesan, penyimpanan dan hak data pribadi.",
    url: "/kebijakan-privasi",
    siteName: "Buku",
    locale: "id_ID",
    type: "website",
  },
};
export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  return <LegalPage document={PUBLIC_PRIVACY} />;
}
