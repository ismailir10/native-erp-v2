"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Link2, Send } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/app/simple-select";
import { createUploadLinkAction, revokeUploadLinkAction } from "@/app/actions";

export type UploadLinkRow = { id: string; intakeId: string; created: string; expires: string; lastUsed: string | null; files: number; active: boolean };

/** Tautan unggah klien (I1d): make a link (shown once), see what came in through each, revoke it. */
export function UploadLinksCard({ clientId, clientName, links }: { clientId: string; clientName: string; links: UploadLinkRow[] }) {
  const router = useRouter();
  const [days, setDays] = useState("14");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ url: string; expires: string } | null>(null);
  const create = async () => {
    setBusy(true);
    const r = await createUploadLinkAction(clientId, Number(days));
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    setMade({ url: r.url, expires: r.expires });
    router.refresh();
  };
  const revoke = async (id: string) => {
    setBusy(true);
    const r = await revokeUploadLinkAction(clientId, id);
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("Tautan dicabut");
    router.refresh();
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Tautan tersalin");
    } catch {
      toast.message("Pilih tautannya lalu tekan Ctrl+C untuk menyalin");
    }
  };
  const received = links.filter((l) => l.files > 0).reduce((s, l) => s + l.files, 0);
  return (
    <Card data-testid="upload-links">
      <CardHeader>
        <CardTitle>Tautan unggah klien</CardTitle>
        <CardDescription>
          Klien mengirim file tanpa akun. File masuk ke Dokumen untuk Anda periksa; tidak ada yang diimpor atau dijurnal otomatis. Tautan hanya bisa mengunggah, tidak bisa melihat apa pun.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-40"><SimpleSelect label="Masa berlaku" value={days} onChange={setDays} options={[{ value: "7", label: "Berlaku 7 hari" }, { value: "14", label: "Berlaku 14 hari" }, { value: "30", label: "Berlaku 30 hari" }]} /></div>
          <Button variant="outline" disabled={busy} onClick={create}><Link2 /> Buat tautan unggah</Button>
        </div>
        {made && (
          <div className="space-y-2 rounded-md border p-3" data-testid="upload-link-made">
            <p>Tautan baru, berlaku sampai {made.expires}. Salin sekarang: tautan ini hanya ditampilkan sekali.</p>
            <div className="flex gap-2">
              <Input readOnly value={made.url} aria-label="Tautan unggah" className="font-mono text-xs" onFocus={(e) => e.target.select()} />
              <Button variant="outline" onClick={() => copy(made.url)}><Copy /> Salin</Button>
            </div>
            <a
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href={`https://wa.me/?text=${encodeURIComponent(`Untuk ${clientName}: mohon unggah rekening koran dan dokumen bulan ini di tautan berikut (tanpa perlu akun, berlaku sampai ${made.expires}):\n${made.url}`)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Send /> Kirim lewat WhatsApp
            </a>
          </div>
        )}
        {links.length > 0 && (
          <ul className="divide-y rounded-md border">
            {links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" data-testid="upload-link-row">
                <div className="min-w-0 flex-1">
                  <div>{l.active ? `Aktif s.d. ${l.expires}` : `Tidak aktif (dibuat ${l.created})`}</div>
                  <div className="text-xs text-muted-foreground">{l.files} file diterima{l.lastUsed ? ` · terakhir ${l.lastUsed}` : ""}</div>
                </div>
                {l.files > 0 && <Link href={`/documents/${l.intakeId}`} className="text-primary underline-offset-2 hover:underline">Buka file</Link>}
                {l.active && <Button variant="ghost" size="sm" disabled={busy} onClick={() => revoke(l.id)}>Cabut</Button>}
              </li>
            ))}
          </ul>
        )}
        {received > 0 && <p className="text-muted-foreground" data-testid="upload-link-received">{received} file dari klien lewat tautan. Periksa dan impor dari Dokumen.</p>}
      </CardContent>
    </Card>
  );
}
