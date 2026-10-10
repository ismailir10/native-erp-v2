"use client";
import Link from "next/link";
import { PublicShell } from "@/components/app/public-shell";
import { Button } from "@/components/ui/button";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  // Next records this digest with the original server-render error. Never render error.message or its stack.
  const reference = error.digest && /^[0-9a-f-]{1,64}$/i.test(error.digest) ? error.digest : undefined;
  return <PublicShell title="Ada yang salah di sisi kami" description="Coba lagi. Jika masih terjadi, hubungi pengelola Buku." footer={reference ? `Referensi: ${reference}` : undefined}>
    <div className="flex flex-col gap-3">
      <Button onClick={retry} className="w-full">Coba lagi</Button>
      <Button variant="outline" render={<Link href="/login" />} nativeButton={false} className="w-full">Kembali ke halaman masuk</Button>
    </div>
  </PublicShell>;
}
