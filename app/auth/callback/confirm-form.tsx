"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { LinkToken } from "./token";

export function ConfirmForm({ token }: { token: LinkToken }) {
  const [busy, setBusy] = useState(false);
  // Keep the secret in the form only, not browser history or subsequent referrers. No auth call on mount.
  useEffect(() => { window.history.replaceState(null, "", "/auth/callback"); }, []);
  return <form method="post" action="/auth/callback/confirm" onSubmit={() => setBusy(true)} aria-busy={busy}>
    {"code" in token ? <input type="hidden" name="code" value={token.code} /> : <>
      <input type="hidden" name="token_hash" value={token.tokenHash} />
      <input type="hidden" name="type" value={token.type} />
    </>}
    <Button type="submit" className="w-full" disabled={busy}>{busy ? "Memeriksa tautan…" : "Lanjutkan"}</Button>
  </form>;
}
