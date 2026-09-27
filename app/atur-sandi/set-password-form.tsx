"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient, readAuthFragment } from "@/lib/supabase/browser";

const MIN = 8;

export function SetPasswordForm({ url, publishableKey, linkError }: { url: string; publishableKey: string; linkError?: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(url, publishableKey), [url, publishableKey]);
  const [ready, setReady] = useState<"checking" | "ok" | "missing">(linkError ? "missing" : "checking");
  const [hashError, setHashError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (linkError) return;
    let cancelled = false;
    (async () => {
      const fragment = readAuthFragment(window.location.hash);
      if (fragment && "error" in fragment) { setHashError(fragment.error); setReady("missing"); return; }
      if (fragment) {
        // Adopt the link's tokens into the cookie session, then drop them from the address bar.
        const { error } = await supabase.auth.setSession({ access_token: fragment.accessToken, refresh_token: fragment.refreshToken });
        window.history.replaceState(null, "", window.location.pathname);
        if (!cancelled) setReady(error ? "missing" : "ok");
        return;
      }
      // A PKCE link was already exchanged by /auth/callback; the session is in the cookies.
      const { data } = await supabase.auth.getSession();
      if (!cancelled) setReady(data.session ? "ok" : "missing");
    })();
    return () => { cancelled = true; };
  }, [supabase, linkError]);

  async function submit() {
    if (busy) return;
    if (password.length < MIN) { setError(`Kata sandi minimal ${MIN} karakter.`); return; }
    if (password !== confirm) { setError("Ulangi kata sandi yang sama di kedua kolom."); return; }
    setBusy(true); setError("");
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) { setError(error.code === "same_password" ? "Gunakan kata sandi yang berbeda dari sebelumnya." : "Kata sandi belum tersimpan. Minta tautan baru lalu coba lagi."); return; }
      router.push("/"); router.refresh();
    } catch { setError("Koneksi terputus. Periksa internet lalu coba lagi."); }
    finally { setBusy(false); }
  }

  if (ready === "missing") return <div className="space-y-4">
    <p role="alert" className="text-sm text-fail">{(linkError ?? hashError) === "expired" ? "Tautan sudah kedaluwarsa." : "Tautan tidak berlaku atau sudah dipakai."} Minta tautan baru untuk melanjutkan.</p>
    <Button render={<Link href="/login/lupa" />} nativeButton={false} className="w-full">Minta tautan baru</Button>
  </div>;

  return <form onSubmit={event => { event.preventDefault(); void submit(); }} className="space-y-5" aria-busy={busy || ready === "checking"}>
    <div className="space-y-2"><Label htmlFor="password">Kata sandi baru</Label><Input id="password" type="password" autoComplete="new-password" minLength={MIN} required value={password} onChange={e => setPassword(e.target.value)} aria-describedby="password-hint" autoFocus /><p id="password-hint" className="text-sm text-muted-foreground">Minimal {MIN} karakter.</p></div>
    <div className="space-y-2"><Label htmlFor="confirm">Ulangi kata sandi</Label><Input id="confirm" type="password" autoComplete="new-password" minLength={MIN} required value={confirm} onChange={e => setConfirm(e.target.value)} /></div>
    {error && <p role="alert" className="text-sm text-fail">{error}</p>}
    <Button type="submit" className="w-full" disabled={busy || ready === "checking"}>{ready === "checking" ? "Memeriksa tautan…" : busy ? "Menyimpan…" : "Simpan dan masuk"}</Button>
  </form>;
}
