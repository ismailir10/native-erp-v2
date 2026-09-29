"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteClientAction } from "@/app/actions";

/** Admin-only removal of a client entered by mistake or a test copy: the typed name is the confirmation. */
export function DeleteClientCard({ clientId, name }: { clientId: string; name: string }) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const matches = typed.trim() === name;
  return (
    <Card className="border-fail/40" data-testid="delete-client">
      <CardHeader>
        <CardTitle>Hapus klien</CardTitle>
        <CardDescription>
          Menghapus {name} beserta semua entitas, rekening, mutasi, jurnal, laporan, dokumen dan catatan tutup bukunya. Tidak bisa dibatalkan.
          Pakai hanya untuk klien yang salah dibuat atau data uji.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1 space-y-1">
          <label htmlFor="delete-client-name" className="text-sm">Ketik nama klien untuk konfirmasi</label>
          <Input id="delete-client-name" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={name} autoComplete="off" />
        </div>
        <Button
          variant="destructive"
          disabled={!matches || busy}
          onClick={async () => {
            setBusy(true);
            const r = await deleteClientAction(clientId, typed);
            setBusy(false);
            if (!r.ok) return void toast.error(r.error);
            toast.success(`${name} dihapus`);
            router.push("/");
            router.refresh();
          }}
        >
          <Trash2 /> Hapus klien
        </Button>
      </CardContent>
    </Card>
  );
}
