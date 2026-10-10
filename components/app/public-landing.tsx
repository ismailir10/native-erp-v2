import Link from "next/link";
import { PublicSiteFrame } from "@/components/app/public-site-frame";
import { buttonVariants } from "@/components/ui/button";

export function PublicLanding() {
  return <PublicSiteFrame><section className="page-settle mx-auto max-w-7xl px-5 py-16 sm:px-8">
    <p className="eyebrow text-muted-foreground">Untuk kantor akuntan dan perusahaan</p>
    <h1 className="display mt-5 max-w-3xl text-5xl sm:text-6xl">Dari rekening koran ke laporan keuangan.</h1>
    <p className="mt-6 max-w-2xl text-lg text-muted-foreground">Tinjau usulan jurnal, telusuri setiap angka ke sumbernya, lalu tutup buku setelah diperiksa.</p>
    <div className="mt-8 flex flex-wrap gap-3"><Link href="/daftar" className={buttonVariants({ size: "lg" })}>Minta akses uji coba</Link><Link href="/deck" className={buttonVariants({ size: "lg", variant: "outline" })}>Lihat deck</Link></div>
  </section></PublicSiteFrame>;
}
