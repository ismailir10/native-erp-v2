import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "http://localhost:3000"),
  title: { default: "Buku · Pembukuan dan tutup buku", template: "%s · Buku" },
  description: "Rekening koran jadi jurnal, buku besar, dan laporan keuangan. Setiap angka bisa ditelusuri ke baris banknya.",
  icons: { icon: "/icon.svg", apple: "/auth/callback/logo" },
  openGraph: { title: "Buku", siteName: "Buku", locale: "id_ID", type: "website", description: "Pembukuan yang bisa ditelusuri. Dokumen, buku besar, dan tutup buku dalam satu ruang kerja." },
  twitter: { card: "summary_large_image", title: "Buku", description: "Pembukuan yang bisa ditelusuri." },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        {children}
        <Toaster position="bottom-right" closeButton />
      </body>
    </html>
  );
}
