"use client";
import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { AuthShell } from "@/app/login/shell";
import { Button } from "@/components/ui/button";
import { fragmentTarget } from "./token";

const noSubscribe = () => () => {};

/** A link without a token in the query: read the fragment in the browser, forward a session, otherwise say the link is spent. */
export function FragmentLink() {
  // The server (and the first paint) has no fragment: null renders the neutral "checking" state, never the error.
  const hash = useSyncExternalStore(noSubscribe, () => window.location.hash, () => null);
  const target = hash === null ? null : fragmentTarget(hash);
  const to = target && "to" in target ? target.to : null;
  // replace(): the fragment never stays in history on this page.
  useEffect(() => { if (to) window.location.replace(to); }, [to]);
  if (!target || "to" in target) return <AuthShell title="Membuka tautan…" description="Sebentar, kami memeriksa tautan dari email Anda."><p role="status" className="text-sm text-muted-foreground">Memeriksa tautan…</p></AuthShell>;
  return <AuthShell title="Tautan tidak berlaku" description={target.error === "expired" ? "Tautan sudah kedaluwarsa. Minta tautan baru untuk melanjutkan." : "Tautan sudah kedaluwarsa atau sudah dipakai. Minta tautan baru untuk melanjutkan."}>
    <Button render={<Link href="/login/lupa" />} nativeButton={false} className="w-full">Kirim tautan baru</Button>
  </AuthShell>;
}
