"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteInstalmentAction, setInstalmentAction } from "@/app/actions";

/** PPh 25 angsuran (rule 5j): the instalments set, each from a masa onward, and the form to set one. Amounts arrive formatted. */
export type InstalmentItem = { id: string; label: string; amount: string };

export function Pph25Instalment({ clientId, entityId, period, items }: { clientId: string; entityId: string; period: string; items: InstalmentItem[] }) {
  const router = useRouter();
  const [from, setFrom] = useState(period);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    const r = await setInstalmentAction({ clientId, entityId, from, amount });
    setBusy(false);
    if (!r.ok) return void setError(r.error);
    setError(null);
    setAmount("");
    toast.success("Angsuran PPh 25 disimpan");
    router.refresh();
  }

  async function remove(id: string) {
    const r = await deleteInstalmentAction({ clientId, id });
    if (!r.ok) return void toast.error(r.error);
    toast.success("Angsuran PPh 25 dihapus");
    router.refresh();
  }

  return (
    <div className="mt-1 space-y-2" data-testid="pph25-instalment">
      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-2">
              <span>
                Angsuran <span className="num">{i.amount}</span> per bulan mulai masa {i.label}
              </span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => remove(i.id)} aria-label={`Hapus angsuran mulai masa ${i.label}`}>
                <Trash2 /> Hapus
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input type="month" aria-label="Masa mulai angsuran" className="h-7 w-40 text-xs" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input aria-label="Angsuran PPh 25 per bulan" placeholder="mis. 5.000.000" className="h-7 w-56 text-xs" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Button variant="outline" size="sm" className="h-7" onClick={save} disabled={busy || !amount.trim()} data-testid="pph25-save">
          {busy ? "Menyimpan…" : items.length ? "Ubah angsuran" : "Simpan angsuran"}
        </Button>
      </div>
      <p>Dari SPT tahunan terakhir (atau SKP / pembetulan); berlaku mulai masa yang dipilih sampai diubah lagi.</p>
      {error && <p role="alert" className="text-fail">{error}</p>}
    </div>
  );
}
