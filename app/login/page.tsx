import { redirect } from "next/navigation";
import { getWorkspaceSession } from "@/lib/auth/session";
import { authConfigured } from "@/lib/auth";
import { AuthShell } from "./shell";
import { LoginForm } from "./login-form";

// Login configuration is runtime env; never prerender a build-time "not configured" page.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const configured = authConfigured();
  if (configured && await getWorkspaceSession()) redirect("/");
  return <AuthShell title="Masuk ke ruang kerja" description="Kelola dokumen, pembukuan, dan tutup buku kantor Anda." footer="Akses hanya melalui undangan admin kantor. Seluruh anggota kantor berbagi ruang kerja yang sama.">
    {configured ? <LoginForm /> : <p role="alert" className="text-sm text-muted-foreground">Akses belum siap. Hubungi pengelola untuk mengaktifkan login kantor Anda.</p>}
  </AuthShell>;
}
