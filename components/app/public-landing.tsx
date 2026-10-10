import Image from "next/image";
import Link from "next/link";
import { PublicSiteFrame } from "@/components/app/public-site-frame";
import { PublicProductIllustration } from "@/components/app/public-product-illustration";
import { buttonVariants } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { PUBLIC_BANK_COUNT, PUBLIC_BANK_COVERAGE, type PublicProductAsset, type PublicProductEvidence } from "@/lib/public-product";
import capture from "@/public/product/capture-manifest.json";

const product: PublicProductEvidence = capture;
const month = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${product.period}-01T00:00:00Z`));
const demoLabel = "Data demonstrasi sintetis. Nama, rekening, dan angka rekaan.";
const amount = (value: string) => formatMoney(BigInt(value), "IDR");

function asset(file: string): PublicProductAsset {
  const found = product.assets.find((image) => image.file === `/product/${file}.webp`);
  if (!found) throw new Error(`Missing public product asset: ${file}`);
  return found;
}

/** Saved genuine app views; the phone source is an independently captured readable view. */
function ProductImage({ name, mobileName = `${name}-mobile`, mobileDetail, alt, caption }: { name: string; mobileName?: string; mobileDetail?: string; alt: string; caption: React.ReactNode }) {
  const desktop = asset(name);
  const mobile = asset(mobileName);
  const detail = mobileDetail ? asset(mobileDetail) : null;
  return <figure className="min-w-0">
    <div className="overflow-hidden rounded-xl border bg-card">
      <picture>
        <source media="(max-width: 767px)" srcSet={mobile.file} width={mobile.width} height={mobile.height} />
        <Image src={desktop.file} alt={alt} width={desktop.width} height={desktop.height} sizes="(max-width: 767px) 100vw, (max-width: 1279px) 60vw, 760px" loading="lazy" className="block h-auto w-full" />
      </picture>
      {detail && <Image src={detail.file} alt={detail.description} width={detail.width} height={detail.height} sizes="100vw" loading="lazy" className="block h-auto w-full border-t md:hidden" />}
    </div>
    <figcaption className="mt-3 space-y-1 break-words text-xs leading-relaxed text-muted-foreground">
      <p>{caption}</p><p>{demoLabel}</p>
    </figcaption>
  </figure>;
}

function MobileFullView({ name, summary, alt, caption }: { name: string; summary: string; alt: string; caption: React.ReactNode }) {
  const image = asset(name);
  return <details className="mt-5 border-t pt-4 md:hidden">
    <summary className="cursor-pointer text-sm font-medium">{summary}</summary>
    <figure className="mt-4">
      <Image src={image.file} alt={alt} width={image.width} height={image.height} sizes="100vw" loading="lazy" className="h-auto w-full rounded-xl border bg-card" />
      <figcaption className="mt-3 text-xs leading-relaxed text-muted-foreground">{caption} {demoLabel}</figcaption>
    </figure>
  </details>;
}

function BankFormats() {
  const evidenceLabel = { REAL: "contoh file", PUBLISHED: "format terdokumentasi", INFERRED: "pola umum, belum contoh asli" };
  return <details className="mt-10 border-y py-5" data-testid="public-bank-formats">
    <summary className="cursor-pointer text-sm font-medium">Bank dan format yang dikenali ({PUBLIC_BANK_COUNT} bank)</summary>
    <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">Dukungan berlaku untuk format berikut, bukan semua file dari bank yang sama. PDF, CSV, Excel dan MT940 dibaca sesuai tata letaknya. Sebagian format mengikuti pola umum dan belum diuji dengan contoh asli dari bank; file yang berbeda perlu diperiksa saat diimpor. Yang masuk adalah file yang Anda unggah.</p>
    <dl className="mt-5 divide-y">
      {PUBLIC_BANK_COVERAGE.map((bank) => <div key={bank.code} className="grid gap-2 py-3 sm:grid-cols-[11rem_1fr]">
        <dt className="text-sm font-medium">{bank.name}</dt>
        <dd className="text-sm leading-relaxed text-muted-foreground">{bank.formats.map((format, index) => <span key={format.label}>{index > 0 && "; "}{format.label} ({evidenceLabel[format.evidence]})</span>)}</dd>
      </div>)}
    </dl>
  </details>;
}

export function PublicLanding() {
  const blocker = product.close.controls.find((control) => control.status !== "PASS");
  return <PublicSiteFrame>
    <div className="mx-auto max-w-7xl px-5 sm:px-8">
      <section aria-labelledby="landing-title" className="pb-10 pt-12 sm:pt-20">
        <div className="grid items-start gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
          <div className="min-w-0 lg:pt-6">
            <p className="eyebrow text-muted-foreground">Untuk kantor akuntan dan perusahaan</p>
            <h1 id="landing-title" className="display mt-5 max-w-xl text-[2.65rem] sm:text-6xl">Dari rekening koran ke laporan keuangan.</h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">Setiap angka bisa ditelusuri. Akuntan Anda memutuskan yang perlu ditinjau.</p>
            <div className="mt-8 flex flex-wrap gap-3"><Link href="/daftar" className={buttonVariants({ size: "lg" })}>Minta akses uji coba</Link><Link href="/deck" className={buttonVariants({ size: "lg", variant: "outline" })}>Lihat deck</Link></div>
          </div>
          <PublicProductIllustration evidence={product} />
        </div>
      </section>

      <section aria-labelledby="source-title" className="border-t py-10 sm:py-12">
        <div className="grid items-start gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
          <div><p className="eyebrow text-muted-foreground">Sumber dan jurnal</p><h2 id="source-title" className="display mt-4 text-3xl sm:text-4xl">Dari baris bank ke jurnalnya.</h2></div>
          <div>
            <p className="text-base leading-relaxed text-muted-foreground">Buka angka di laporan, telusuri Buku Besar, lalu periksa jurnal dan baris sumbernya. Nama file, nomor baris dan keterangan asli tetap bisa dibuka.</p>
            <p className="mt-4 text-sm leading-relaxed">Pada contoh ini, uang masuk <span className="num">{amount(product.source.amount)}</span> menjadi jurnal dengan debit dan kredit yang sama. Sumbernya {product.source.fileName}, baris <span className="num">{product.source.rowNumber}</span>.</p>
          </div>
        </div>
        <div className="mt-8 grid items-start gap-6 md:grid-cols-2">
            <ProductImage name="bank-source" alt={`Baris sumber rekening koran ${product.reportEntity.name} senilai ${amount(product.source.amount)}, dari ${product.source.fileName} baris ${product.source.rowNumber}.`} caption={<>{product.reportEntity.name} · {month}. Baris sumber yang dibuka dari Buku Besar.</>} />
            <ProductImage name="journal" mobileName="journal-detail" alt={`Jurnal dari baris bank yang sama: debit ${amount(product.source.journalDebit)} sama dengan total kredit. Kode akun serta masing-masing nominal terlihat.`} caption={<>Jurnal terkait: {product.source.lines.map((line) => `${line.code} ${line.name}`).join("; ")}.</>} />
        </div>
        <BankFormats />
      </section>

      <section aria-labelledby="firm-title" className="grid items-start gap-8 border-b py-12 sm:py-16 lg:grid-cols-[0.75fr_1.25fr] lg:gap-14">
        <div className="min-w-0">
          <p className="eyebrow text-muted-foreground">Kantor akuntan</p>
          <h2 id="firm-title" className="display mt-4 text-3xl sm:text-4xl">Pekerjaan tiap klien, sampai bulan bisa ditutup.</h2>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground">Kelola pembukuan beberapa klien dalam satu kantor. Akuntan membuka klien yang ditugaskan, meninjau usulan akun, dan memeriksa temuan sebelum Tutup Buku.</p>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">Aturan dan keputusan yang sudah dikenali bisa membukukan transaksi langsung. Usulan AI menunggu persetujuan akuntan. Selisih menjadi temuan yang perlu diputuskan.</p>
          <p className="mt-6 border-t pt-5 text-sm leading-relaxed">Di buku demo {month}, {blocker ? <>temuan “{blocker.title}” masih perlu diperiksa. </> : null}Bulan belum bisa dikunci. Kontrol yang lolos tetap bisa dibuka di daftar yang sama.</p>
          <Link href="/deck/kantor.html" className="drill mt-6 inline-block text-sm">Baca deck kantor akuntan</Link>
        </div>
        <div className="min-w-0">
          <ProductImage name="close-checklist" mobileName="close-blocker-detail" mobileDetail="close-pass-detail" alt={`Kontrol Tutup Buku ${product.client.name} ${month}: temuan yang perlu diperiksa. Tampilan lengkap mencakup kontrol lolos dan daftar periksa akuntan.`} caption={<>{product.firm.name} · {product.client.name} · {month}. Daftar lengkap mencakup semua entitas; rincian temuan dan kontrol yang lolos pada ponsel untuk {blocker?.scope}.</>} />
          <MobileFullView name="close-checklist-mobile" summary="Lihat daftar periksa lengkap" alt={`Daftar periksa lengkap Tutup Buku ${product.client.name} ${month}, termasuk temuan, kontrol yang lolos dan persetujuan yang harus diisi akuntan.`} caption={<>{product.client.name} · {month}, semua entitas.</>} />
        </div>
      </section>

      <section aria-labelledby="company-title" className="grid items-start gap-8 border-b py-12 sm:py-16 lg:grid-cols-[1.25fr_0.75fr] lg:gap-14">
        <div className="min-w-0 lg:col-start-2 lg:row-start-1">
          <p className="eyebrow text-muted-foreground">Perusahaan</p>
          <h2 id="company-title" className="display mt-4 text-3xl sm:text-4xl">Buku perusahaan Anda, dikerjakan bersama akuntan.</h2>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground">Kirim rekening koran dan saldo awal. Tim keuangan atau kantor akuntan Anda meninjau transaksi dan menutup bulan; Anda membaca laporan dari pembukuan yang sama.</p>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">Neraca Saldo, Laba Rugi dan Neraca dihitung dari jurnal yang sudah dibukukan. Laporan bisa diunduh dalam Excel dan PDF; angka dari rekening koran dapat ditelusuri kembali ke sumbernya.</p>
          <p className="mt-6 border-t pt-5 text-sm leading-relaxed">Neraca Saldo {product.reportEntity.name} pada contoh ini seimbang: total saldo debit dan kredit masing-masing <span className="num">{amount(product.trialBalance.debit)}</span>.</p>
          <Link href="/deck/perusahaan.html" className="drill mt-6 inline-block text-sm">Baca deck perusahaan</Link>
        </div>
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <ProductImage name="trial-balance" mobileName="trial-balance-totals-mobile" alt={`Neraca Saldo ${product.reportEntity.name} ${month}, total saldo debit dan kredit seimbang sebesar ${amount(product.trialBalance.debit)}.`} caption={<>{product.reportEntity.name} · {month}. Neraca Saldo dari jurnal yang sudah dibukukan; rincian total debit dan kredit pada ponsel.</>} />
          <MobileFullView name="trial-balance-mobile" summary="Lihat Neraca Saldo lengkap" alt={`Daftar akun dan saldo debit kredit Neraca Saldo ${product.reportEntity.name} ${month}, termasuk total yang seimbang.`} caption={<>{product.reportEntity.name} · {month}.</>} />
        </div>
      </section>

      <section aria-labelledby="trial-title" className="flex flex-col items-start gap-6 py-12 sm:py-16 md:flex-row md:items-center md:justify-between">
        <div className="max-w-2xl"><h2 id="trial-title" className="display text-3xl">Mulai dengan satu bulan.</h2><p className="mt-3 text-base leading-relaxed text-muted-foreground">Minta akses uji coba untuk kantor akuntan atau perusahaan Anda. Tim Buku meninjau permintaan, lalu mengirim undangan. Baca <Link href="/syarat" className="drill">Syarat</Link> dan <Link href="/kebijakan-privasi" className="drill">Privasi</Link>, termasuk akses dukungan dan pemrosesan data.</p></div>
        <Link href="/daftar" className={buttonVariants({ size: "lg", className: "shrink-0" })}>Minta akses uji coba</Link>
      </section>
    </div>
  </PublicSiteFrame>;
}
