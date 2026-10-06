"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/app/status";
import { setOcrAction } from "@/app/settings-actions";

/** Baca scan dengan AI (I2a): off by default; when on, scan images of statements are sent to the configured AI provider (UU PDP). */
export function OcrSettingCard({ enabled, canSave, aiLive }: { enabled: boolean; canSave: boolean; aiLive: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await setOcrAction(on);
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(on ? "Baca scan dengan AI aktif" : "Baca scan dengan AI dimatikan");
    router.refresh();
  };
  return (
    <Card data-testid="ocr-setting">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Baca scan dengan AI <StatusPill status={enabled ? "PASS" : "REVIEW"} label={enabled ? "Aktif" : "Mati"} />
        </CardTitle>
        <CardDescription>
          Rekening koran hasil scan atau foto dibaca oleh model AI, lalu setiap baris diperiksa dengan saldo berjalan sebelum bisa diimpor. Gambar scan dikirim ke penyedia AI yang diatur di atas; nama dan nomor rekening di gambar tidak bisa disamarkan. Nyalakan hanya bila klien setuju datanya diproses penyedia AI (UU PDP).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!aiLive && <p className="text-muted-foreground">AI belum aktif: atur kunci dan model dulu, dan pilih model yang bisa membaca gambar.</p>}
        <div className="flex items-center gap-2">
          <Checkbox id="ocr-on" checked={on} disabled={!canSave || busy} onCheckedChange={(v) => setOn(v === true)} />
          <label htmlFor="ocr-on">Izinkan Buku mengirim gambar scan rekening koran ke penyedia AI</label>
        </div>
        {canSave ? (
          <Button variant="outline" size="sm" disabled={busy || on === enabled} onClick={save}>Simpan</Button>
        ) : (
          <p className="text-xs text-muted-foreground">Hanya admin kantor yang dapat mengubah ini.</p>
        )}
      </CardContent>
    </Card>
  );
}
