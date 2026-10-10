"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type State = { kind: "loading" } | { kind: "done" } | { kind: "verify"; factorId: string } | { kind: "enroll"; factorId: string; qr: string; secret: string };

/**
 * Two-step login for a Buku admin (authenticator app, TOTP), required before a support session. The app shows the entry as "Buku".
 * Verifying upgrades this browser's session to aal2.
 */
export function MfaSetup({ url, publishableKey }: { url: string; publishableKey: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const auth = createSupabaseBrowserClient(url, publishableKey).auth;
    (async () => {
      const level = await auth.mfa.getAuthenticatorAssuranceLevel();
      if (level.data?.currentLevel === "aal2") return setState({ kind: "done" });
      const factors = await auth.mfa.listFactors();
      const verified = factors.data?.totp.find((f) => f.status === "verified");
      if (verified) return setState({ kind: "verify", factorId: verified.id });
      // An unfinished enrolment is replaced, so the QR code shown is always the one that will work.
      for (const f of factors.data?.all ?? []) if (f.status === "unverified") await auth.mfa.unenroll({ factorId: f.id });
      const enrolled = await auth.mfa.enroll({ factorType: "totp", issuer: "Buku", friendlyName: "Buku" });
      if (enrolled.error || !enrolled.data) return void toast.error("Verifikasi dua langkah belum bisa disiapkan. Muat ulang halaman.");
      setState({ kind: "enroll", factorId: enrolled.data.id, qr: enrolled.data.totp.qr_code, secret: enrolled.data.totp.secret });
    })();
  }, [url, publishableKey]);

  async function verify(factorId: string) {
    setBusy(true);
    const r = await createSupabaseBrowserClient(url, publishableKey).auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setBusy(false);
    if (r.error) return void toast.error("Kode tidak cocok atau sudah lewat. Coba kode yang baru.");
    toast.success("Verifikasi dua langkah aktif");
    setState({ kind: "done" });
    router.refresh();
  }

  if (state.kind === "loading") return <p className="text-sm text-muted-foreground"><Loader2 className="inline size-4 animate-spin" /> Memeriksa…</p>;
  if (state.kind === "done") return <p className="text-sm" data-testid="mfa-done">Verifikasi dua langkah aktif untuk sesi ini.</p>;
  return (
    <div className="space-y-4" data-testid="mfa-setup">
      {state.kind === "enroll" && (
        <div className="flex flex-wrap items-start gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL from the enrolment, not a static asset */}
          <img src={state.qr} alt="Kode QR untuk aplikasi autentikator" className="size-40 rounded-lg border bg-white p-2" />
          <div className="min-w-0 flex-1 space-y-1 text-sm">
            <p>Pindai dengan aplikasi autentikator (Google Authenticator, 1Password, Authy), atau ketik kunci ini:</p>
            <p className="break-all font-mono" data-testid="totp-secret">{state.secret}</p>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1"><label htmlFor="mfa-code" className="text-sm">Kode 6 angka</label><Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} className="w-36" /></div>
        <Button disabled={busy || code.trim().length !== 6} onClick={() => verify(state.factorId)}>{busy && <Loader2 className="animate-spin" />}Verifikasi</Button>
      </div>
    </div>
  );
}
