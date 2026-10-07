"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatRupiah } from "@/lib/money";
import { postPpnOffsetAction } from "@/app/actions";

/** The PPN compensation still to journal at the masa end (accounting-rules 5j), with its one click. Amount arrives as a string. */
export function PpnOffset({ clientId, entityId, year, month, amount, date }: { clientId: string; entityId: string; year: number; month: number; amount: string; date: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const v = BigInt(amount);
  const over = v < 0n;

  async function post() {
    setBusy(true);
    const r = await postPpnOffsetAction({ clientId, entityId, year, month });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Jurnal kompensasi PPN dicatat");
    router.refresh();
  }

  return (
    <div id="ppn-offset" className="mt-1 flex scroll-mt-6 flex-wrap items-center gap-x-3 gap-y-1" data-testid="ppn-offset">
      <span>
        {over ? "Kompensasi PPN berlebih" : "PPN masukan belum dikompensasikan ke keluaran"}: <span className="num">{formatRupiah(over ? -v : v)}</span>{" "}
        ({over ? "Dr 1150 PPN Masukan / Cr 2130 PPN Keluaran" : "Dr 2130 PPN Keluaran / Cr 1150 PPN Masukan"} per {date}).
      </span>
      <Button variant="outline" size="sm" className="h-7" onClick={post} disabled={busy} data-testid="ppn-offset-post">
        {busy ? "Mencatat…" : "Catat kompensasi"}
      </Button>
    </div>
  );
}
