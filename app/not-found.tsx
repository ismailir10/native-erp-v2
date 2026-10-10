import Link from "next/link";
import { PublicShell } from "@/components/app/public-shell";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return <PublicShell title="Halaman tidak ditemukan" description="Alamat ini tidak tersedia atau Anda tidak memiliki akses. Periksa tautan, atau kembali ke halaman masuk.">
    <Button render={<Link href="/login" />} nativeButton={false} className="w-full">Kembali ke halaman masuk</Button>
  </PublicShell>;
}
