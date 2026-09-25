import { BookOpen } from "lucide-react";
import { redirect } from "next/navigation";
import { getWorkspaceSession } from "@/lib/auth/session";
import { authConfigured } from "@/lib/auth";
import { LoginForm, SharedCodeLoginForm } from "./login-form";

export default async function LoginPage() {
  const configured = authConfigured();
  if (configured && await getWorkspaceSession()) redirect("/");
  return <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-12">
    <section className="w-full max-w-md rounded-lg border bg-card p-6 shadow-xs sm:p-8" aria-labelledby="login-title">
      <div className="mb-8 flex items-center gap-2 text-xl font-semibold"><BookOpen className="size-6 text-primary" aria-hidden="true" />Buku</div>
      <h1 id="login-title" className="text-2xl font-semibold">Masuk ke ruang kerja</h1>
      <p className="mb-6 mt-2 text-sm text-muted-foreground">Kelola dokumen, pembukuan, dan tutup buku kantor Anda.</p>
      {configured ? process.env.AUTH_MODE === "shared-code" ? <SharedCodeLoginForm /> : <LoginForm /> : <p role="alert" className="text-sm text-muted-foreground">Akses belum siap. Hubungi pengelola untuk mengaktifkan login kantor Anda.</p>}
      <p className="mt-6 border-t pt-5 text-xs text-muted-foreground">Akses hanya melalui undangan. Seluruh anggota kantor berbagi ruang kerja yang sama.</p>
    </section>
  </main>;
}
