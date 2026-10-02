import { redirect } from "next/navigation";
import { getWorkspaceSession } from "@/lib/auth/session";
import { authConfigured } from "@/lib/auth";
import { AuthShell } from "./shell";
import { LoginForm } from "./login-form";

export const metadata = { title: "Masuk" };

// Login configuration is runtime env; never prerender a build-time "not configured" page.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const configured = authConfigured();
  if (configured && await getWorkspaceSession()) redirect("/");
  return <AuthShell title="Masuk ke ruang kerja" description="Kelola dokumen, pembukuan, dan tutup buku kantor Anda." footer="Akses hanya melalui undangan admin kantor. Seluruh anggota kantor berbagi ruang kerja yang sama." aside={<ValueProposition />}>
    {configured ? <LoginForm /> : <p role="alert" className="text-sm text-muted-foreground">Akses belum siap. Hubungi pengelola untuk mengaktifkan login kantor Anda.</p>}
  </AuthShell>;
}

/** What Buku does, in three true sentences (no hype, ui-rules): for a visitor deciding whether this is the right place. */
const POINTS = [
  { title: "Rekening koran jadi laporan keuangan", text: "Impor mutasi BCA, Mandiri, BRI atau SMBC dari PDF, Excel atau CSV. Buku mengusulkan akunnya, Anda meninjau, lalu buku besar, neraca saldo, laba rugi dan neraca tersusun sendiri." },
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
            <span className="num font-mono text-sm text-primary" aria-hidden>{String(i + 1).padStart(2, "0")}</span>
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
