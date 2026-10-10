import Link from "next/link";
import { BrandMark } from "@/components/app/brand-mark";
import { buttonVariants } from "@/components/ui/button";

export function PublicHeader() {
  return <header className="relative border-b bg-background">
    <div className="mx-auto flex min-h-20 max-w-7xl items-center justify-between gap-3 px-5 sm:px-8">
      <Link href="/" className="flex items-center gap-2 rounded-md text-xl font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" aria-label="Buku, beranda"><BrandMark />Buku</Link>
      <nav aria-label="Navigasi publik" className="flex items-center gap-1 sm:gap-3">
        <Link href="/login" className={buttonVariants({ variant: "ghost" })}>Masuk</Link>
        <Link href="/daftar" className={buttonVariants({ variant: "outline" })}>Minta uji coba</Link>
      </nav>
    </div>
  </header>;
}

export function PublicFooter({ contact = <span>Hubungi pengelola Buku</span> }: { contact?: React.ReactNode }) {
  return <footer className="relative border-t">
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-7 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
      <p>Buku · Pembukuan yang bisa ditelusuri.</p>
      <nav aria-label="Ketentuan dan kontak" className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Link href="/syarat" className="drill">Syarat</Link><Link href="/kebijakan-privasi" className="drill">Privasi</Link>{contact}
      </nav>
    </div>
  </footer>;
}
