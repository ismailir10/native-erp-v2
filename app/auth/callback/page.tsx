import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/app/login/shell";
import { Button } from "@/components/ui/button";
import { ConfirmForm } from "./confirm-form";
import { readLinkToken } from "./token";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Konfirmasi tautan", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** A scanner may GET this page repeatedly: verification happens only in the confirmation POST. */
export default async function AuthCallbackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const token = params.error ? null : readLinkToken(params);
  return <AuthShell title={token ? "Lanjutkan ke Buku" : "Tautan tidak berlaku"} description={token ? "Konfirmasi untuk membuka tautan dari email Anda." : "Tautan sudah kedaluwarsa atau sudah dipakai. Minta tautan baru untuk melanjutkan."}>
    {token ? <ConfirmForm token={token} /> : <Button render={<Link href="/login/lupa" />} nativeButton={false} className="w-full">Kirim tautan baru</Button>}
  </AuthShell>;
}
