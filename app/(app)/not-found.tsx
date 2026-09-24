import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="text-2xl font-semibold">Halaman tidak ditemukan</h1>
      <p className="mt-2 text-sm text-muted-foreground">Klien atau akun yang Anda cari tidak ada, atau bukan milik kantor Anda.</p>
      <Link href="/" className={buttonVariants({ className: "mt-6" })}>Kembali ke Beranda</Link>
    </div>
  );
}
