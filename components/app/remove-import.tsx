"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { removeImportAction } from "@/app/actions";

const REASON_MIN = 10;

/**
 * Hapus impor (ADR 0013): admin only, with a written reason. Everything the file put in the books goes; the change log keeps what and why.
 * The server refuses closed months and imports something else rests on, and says what to do instead.
 */
export function RemoveImportButton({ clientId, importId, kind, fileName, onDone }: { clientId: string; importId: string; kind: "statement" | "ledger"; fileName: string; onDone?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      const r = await removeImportAction({ clientId, importId, kind, reason });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${fileName} dihapus`, { description: "Jurnalnya ikut terhapus; tercatat di Riwayat perubahan" });
      setOpen(false);
      if (onDone) router.push(onDone);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} data-testid="remove-import" aria-label={`Hapus impor ${fileName}`}>
        <Trash2 /> Hapus
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus impor {fileName}?</DialogTitle>
            <DialogDescription>
              {kind === "statement" ? "Semua mutasi dari file ini dan jurnalnya" : "Semua jurnal dari file ini"} ikut terhapus, sehingga laporan kembali seperti sebelum
              file diimpor. File yang benar bisa diimpor lagi. Penghapusan tercatat di Riwayat perubahan bersama alasannya.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <label htmlFor={`remove-reason-${importId}`} className="text-sm">Alasan</label>
            <Textarea id={`remove-reason-${importId}`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Mis. salah rekening, atau file bulan yang sama dua kali" />
            <p className="text-xs text-muted-foreground">Min. {REASON_MIN} karakter.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button variant="destructive" disabled={busy || reason.trim().length < REASON_MIN} onClick={remove}>{busy ? "Menghapus…" : "Hapus impor"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
