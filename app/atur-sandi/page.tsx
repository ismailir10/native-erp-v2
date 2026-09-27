import { supabaseEnv } from "@/lib/supabase/env";
import { AuthShell } from "@/app/login/shell";
import { SetPasswordForm } from "./set-password-form";

export const dynamic = "force-dynamic";

export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const env = supabaseEnv();
  const { error } = await searchParams;
  return <AuthShell title="Atur kata sandi" description="Buat kata sandi baru untuk akun Buku Anda. Setelah tersimpan, Anda langsung masuk.">
    {env ? <SetPasswordForm url={env.url} publishableKey={env.publishableKey} linkError={error} /> : <p role="alert" className="text-sm text-muted-foreground">Akses belum siap. Hubungi pengelola Buku.</p>}
  </AuthShell>;
}
