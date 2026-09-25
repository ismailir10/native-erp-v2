"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Temporary invitation-only shared code; the server never exposes the configured value. */
export function SharedCodeLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const address = email.trim().toLowerCase();
      const result = await fetch("/api/auth/sign-in/shared-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: address, code }) });
      if (!result.ok) {
        setError(result.status === 429 ? "Terlalu banyak percobaan. Tunggu 10 menit lalu coba lagi." : "Email atau kode akses tidak cocok. Gunakan email yang diundang dan kode terbaru dari pengelola.");
        return;
      }
      router.push("/"); router.refresh();
    } catch { setError("Koneksi terputus. Periksa internet lalu coba lagi."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={event => { event.preventDefault(); void submit(); }} className="space-y-5" aria-busy={busy}>
    <div className="space-y-2"><label htmlFor="shared-email" className="text-sm font-medium">Email yang diundang</label><Input id="shared-email" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} autoFocus /></div>
    <div className="space-y-2"><label htmlFor="shared-code" className="text-sm font-medium">Kode akses 12 angka</label><Input id="shared-code" type="password" inputMode="numeric" autoComplete="current-password" pattern="[0-9]{12}" maxLength={12} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 12))} aria-describedby={error ? "shared-hint login-error" : "shared-hint"} /><p id="shared-hint" className="text-sm text-muted-foreground">Gunakan kode yang diberikan pengelola kantor. Tidak ada kode dikirim lewat email.</p></div>
    {error && <p id="login-error" role="alert" className="text-sm text-fail">{error}</p>}
    <Button type="submit" disabled={busy} className="w-full">{busy ? "Memeriksa…" : "Masuk ke Buku"}</Button>
    <p className="text-sm text-muted-foreground">Belum punya akses? Hubungi pengelola kantor untuk undangan dan kode.</p>
  </form>;
}

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resendAfter, setResendAfter] = useState(0);
  useEffect(() => {
    if (!resendAfter) return;
    const timer = setTimeout(() => setResendAfter((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendAfter]);
  const codeRef = useRef<HTMLInputElement>(null);

  async function sendCode() {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({ email: email.trim().toLowerCase(), type: "sign-in" });
      if (result.error) {
        setError(result.error.status === 429 ? "Terlalu banyak permintaan. Tunggu 10 menit sebelum meminta kode baru." : "Kode belum dapat dikirim. Coba lagi atau hubungi pengelola Buku.");
        return;
      }
      setStep("code"); setOtp(""); setResendAfter(60);
      setNotice("Jika alamat Anda diundang, kode akan masuk ke email. Periksa juga folder spam.");
      requestAnimationFrame(() => codeRef.current?.focus());
    } catch { setError("Koneksi terputus. Periksa internet lalu coba lagi."); }
    finally { setBusy(false); }
  }

  async function verify() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await authClient.signIn.emailOtp({ email: email.trim().toLowerCase(), otp });
      if (result.error) {
        setError(result.error.status === 429 ? "Terlalu banyak percobaan. Tunggu satu menit lalu coba lagi." : "Kode tidak cocok atau sudah kedaluwarsa. Periksa kode terbaru atau minta kode baru.");
        codeRef.current?.focus();
        return;
      }
      router.push("/");
      router.refresh();
    } catch { setError("Koneksi terputus. Periksa internet lalu coba lagi."); }
    finally { setBusy(false); }
  }

  return <form onSubmit={(event) => { event.preventDefault(); void (step === "email" ? sendCode() : verify()); }} className="space-y-5" aria-busy={busy}>
    {step === "email" ? <div className="space-y-2">
      <label htmlFor="email" className="text-sm font-medium">Email yang diundang</label>
      <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} aria-describedby={error ? "access-hint login-error" : "access-hint"} autoFocus />
      <p id="access-hint" className="text-sm text-muted-foreground">Belum punya akses? Hubungi pengelola kantor Anda untuk undangan.</p>
    </div> : <div className="space-y-3">
      <p className="text-sm break-all">Kode untuk <strong>{email}</strong></p>
      <div className="space-y-2"><label htmlFor="otp" className="text-sm font-medium">Kode masuk 6 angka</label>
        <Input ref={codeRef} id="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} aria-describedby={error ? "code-hint login-error" : "code-hint"} className="num text-lg tracking-widest" />
        <p id="code-hint" className="text-sm text-muted-foreground">Berlaku 5 menit. Gunakan kode dari email terbaru.</p>
      </div>
    </div>}
    <p role="status" className="text-sm text-muted-foreground">{notice}</p>
    {error && <p id="login-error" role="alert" className="text-sm text-fail">{error}</p>}
    <Button type="submit" className="w-full" disabled={busy}>{busy ? (step === "email" ? "Mengirim kode…" : "Memeriksa kode…") : (step === "email" ? "Kirim kode masuk" : "Masuk ke Buku")}</Button>
    {step === "code" && <div className="flex flex-wrap justify-between gap-2">
      <Button variant="ghost" type="button" disabled={busy} onClick={() => { setStep("email"); setOtp(""); setError(""); setNotice(""); }}>Ganti email</Button>
      <Button variant="ghost" type="button" disabled={busy || resendAfter > 0} onClick={() => void sendCode()}>{resendAfter > 0 ? `Kirim ulang dalam ${resendAfter} dtk` : "Kirim kode baru"}</Button>
    </div>}
  </form>;
}
