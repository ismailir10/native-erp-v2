import { AuthShell } from "../shell";
import { ForgotPasswordForm } from "../login-form";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return <AuthShell title="Lupa kata sandi" description="Masukkan email Anda. Kami kirim tautan untuk membuat kata sandi baru.">
    <ForgotPasswordForm />
  </AuthShell>;
}
