import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "Buku · tutup buku bulanan untuk kantor akuntan",
  description: "Rekening koran jadi jurnal, buku besar, dan laporan keuangan. Setiap angka bisa ditelusuri ke baris banknya.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        {children}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
