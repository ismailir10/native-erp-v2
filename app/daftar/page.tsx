import Link from "next/link";
import { AuthShell } from "@/app/login/shell";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Minta uji coba" };
export const dynamic = "force-dynamic";

/** The public trial request (ADR 0017 §4). Approval by Buku sends the invitation; nothing is created before that. */
export default function SignupPage() {
  return (
    <AuthShell title="Minta akses uji coba" description="Untuk kantor akuntan dan perusahaan. Tim Buku memeriksa permintaan Anda, lalu mengirim undangan ke email kerja Anda."
      footer={<>Sudah punya akses? <Link href="/login" className="drill">Masuk</Link>. Data yang Anda kirim hanya dipakai untuk menghubungi Anda tentang uji coba.</>}>
      <SignupForm />
    </AuthShell>
  );
}
