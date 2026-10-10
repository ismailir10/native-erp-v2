import Link from "next/link";
import { redirect } from "next/navigation";
import { getWorkspaceSession } from "@/lib/auth/session";
import { getPlatformAdmin } from "@/lib/auth/platform";
import { authConfigured } from "@/lib/auth";
import { PublicContact } from "@/components/app/public-contact";
import { AuthShell } from "./shell";
import { LoginForm } from "./login-form";

export const metadata = {
  title: "Masuk",
  description: "Masuk ke ruang kerja Buku untuk kantor akuntan dan perusahaan.",
  alternates: { canonical: "/login" },
};

// Login configuration is runtime env; never prerender a build-time "not configured" page.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const configured = authConfigured();
  if (configured && await getWorkspaceSession()) redirect("/");
  if (configured && await getPlatformAdmin()) redirect("/backoffice");
  return <AuthShell title="Masuk ke ruang kerja" description="Kelola dokumen, pembukuan, dan tutup buku kantor Anda." footer={<>Belum punya akses? <Link href="/daftar" className="drill">Minta uji coba</Link>. Anggota baru diundang oleh admin kantornya.</>} aside={<ValueProposition />} contact={<PublicContact />}>
    {configured ? <LoginForm /> : <p role="alert" className="text-sm text-muted-foreground">Akses belum siap. Hubungi pengelola untuk mengaktifkan login kantor Anda.</p>}
  </AuthShell>;
}

/** What Buku does, in three true sentences (no hype, ui-rules): for a visitor deciding whether this is the right place. */
const POINTS = [
  { title: "Rekening koran jadi laporan keuangan", text: "Unggah rekening koran dalam format yang didukung. Periksa usulan akun dan transaksi yang perlu ditinjau. Buku Besar, Neraca Saldo, Laba Rugi dan Neraca disusun dari jurnal yang sudah dibukukan." },
  { title: "Setiap angka bisa ditelusuri", text: "Dari baris laporan ke akun, ke buku besar, sampai baris rekening koran atau file sumbernya." },
  { title: "Tutup buku setelah diperiksa", text: "Rekonsiliasi bank, transfer antar rekening dan kewajaran pembukuan dicek dulu. Selisih tidak diseimbangkan diam-diam: ia menjadi temuan yang harus diputuskan." },
];

function ValueProposition() {
  return (
    <section aria-labelledby="value-title" className="page-settle space-y-6" data-testid="value-proposition">
      <h2 id="value-title" className="eyebrow text-muted-foreground">Apa yang dikerjakan Buku</h2>
      <ol className="space-y-5">
        {POINTS.map((p, i) => (
          <li key={p.title} className="flex gap-4 border-t pt-5 first:border-t-0 first:pt-0">
            <span className="icon-tile num size-7 text-xs font-medium" aria-hidden>{String(i + 1).padStart(2, "0")}</span>
            <div>
              <h3 className="font-semibold">{p.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{p.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
