import Link from "next/link";
import { AuthShell } from "@/app/login/shell";
import { PublicContact } from "@/components/app/public-contact";
import { SignupForm } from "./signup-form";

export const metadata = {
  title: "Minta uji coba",
  description: "Minta akses uji coba Buku untuk kantor akuntan atau perusahaan. Permintaan ditinjau sebelum undangan dikirim.",
  alternates: { canonical: "/daftar" },
};
export const dynamic = "force-dynamic";

/** The public trial request (ADR 0017 §4). Approval by Buku sends the invitation; nothing is created before that. */
export default function SignupPage() {
  return (
    <AuthShell title="Minta akses uji coba" description="Untuk kantor akuntan dan perusahaan. Tim Buku memeriksa permintaan Anda, lalu mengirim undangan ke email kerja Anda."
      footer={<>Sudah punya akses? <Link href="/login" className="drill">Masuk</Link>. Permintaan ini belum membuat akun.</>} contact={<PublicContact />}>
      <SignupForm />
    </AuthShell>
  );
}
