import { PageHeader, NextStep } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MfaSetup } from "@/components/backoffice/mfa-setup";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { supabaseEnv } from "@/lib/supabase/env";

export const metadata = { title: "Keamanan" };

/** A Buku admin's two-step login: needed before opening any organisation's workspace (ADR 0017 §2). */
export default async function SecurityPage() {
  const admin = await requirePlatformAdmin();
  const env = supabaseEnv();
  return (
    <div className="space-y-6">
      <PageHeader title="Keamanan" description="Verifikasi dua langkah untuk admin Buku." />
      {admin.aal === "aal2"
        ? <NextStep tone="done">Verifikasi dua langkah aktif untuk sesi ini. Anda bisa membuka ruang kerja organisasi dari halamannya.</NextStep>
        : <NextStep>Aktifkan verifikasi dua langkah sebelum membuka ruang kerja organisasi.</NextStep>}
      <Card>
        <CardHeader><CardTitle>Aplikasi autentikator</CardTitle><CardDescription>Setiap kali masuk, masukkan kode dari aplikasi untuk membuka mode dukungan.</CardDescription></CardHeader>
        <CardContent>{env ? <MfaSetup url={env.url} publishableKey={env.publishableKey} /> : <p className="text-sm text-muted-foreground">Login belum dikonfigurasi di server ini.</p>}</CardContent>
      </Card>
    </div>
  );
}
