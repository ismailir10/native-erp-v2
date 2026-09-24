import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "Buku — tutup buku otomatis untuk kantor akuntan",
  description: "Mutasi rekening koran menjadi laporan keuangan yang bisa ditelusuri, dalam menit.",
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
