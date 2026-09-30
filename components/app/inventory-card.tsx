"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/app/money";
import { StatusPill } from "@/components/app/status";
import { recordInventoryCountAction } from "@/app/actions";
import { formatMoney, MoneyError, parseMoney } from "@/lib/money";

export type InventoryEntityView = {
  entityId: string;
  entity: string;
  currency: string;
  book: string;
  purchasesMonth: string;
  count: { amount: string; note: string | null; by: string | null; at: string; journaled: boolean } | null;
  previous: string | null;
  later: string | null;
};

/** One entity's month-end count: book value, the counted value typed in, the difference that will be journaled. */
function EntityCount({ clientId, year, month, periodLabel, v, locked }: { clientId: string; year: number; month: number; periodLabel: string; v: InventoryEntityView; locked: boolean }) {
  const router = useRouter();
  const [amount, setAmount] = useState(v.count?.amount ? formatMoney(BigInt(v.count.amount), v.currency, { bare: true }) : "");
  const [note, setNote] = useState(v.count?.note ?? "");
  const [busy, setBusy] = useState(false);
  const book = BigInt(v.book);
  let counted: bigint | null = null;
  try {
    counted = amount.trim() ? parseMoney(amount, v.currency) : null;
  } catch (e) {
    if (!(e instanceof MoneyError)) throw e;
  }
  const diff = counted === null ? null : counted - book;
  const done = v.count && BigInt(v.count.amount) === book;
  const disabled = locked || !!v.later;

  const save = async () => {
    setBusy(true);
    const r = await recordInventoryCountAction({ clientId, entityId: v.entityId, year, month, amount, note });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(diff ? `Persediaan akhir ${v.entity} dicatat; selisih ${formatMoney(diff < 0n ? -diff : diff, v.currency)} dijurnal ke 5190` : `Persediaan akhir ${v.entity} dicatat; sama dengan buku, tanpa jurnal`);
    router.refresh();
  };

  return (
    <div className="space-y-3 px-6 py-4" data-testid="inventory-entity">
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill status={done ? "PASS" : "REVIEW"} label={done ? "Sesuai hitungan" : v.count ? "Buku berubah" : "Belum dicatat"} />
        <div className="font-medium">{v.entity}</div>
        <div className="text-xs text-muted-foreground">
          {v.count ? `Dihitung${v.count.by ? ` oleh ${v.count.by}` : ""}, ${v.count.at}` : v.previous ? `Terakhir dihitung ${v.previous}` : "Belum pernah dihitung"}
        </div>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Saldo buku persediaan, akhir {periodLabel}</dt>
          <dd className="mt-0.5 text-base font-semibold"><Money value={book} currency={v.currency} /></dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Pembelian bulan ini (beban pokok)</dt>
          <dd className="mt-0.5"><Money value={BigInt(v.purchasesMonth)} currency={v.currency} /></dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Selisih yang dijurnal</dt>
          <dd className="mt-0.5" data-testid="inventory-diff">
            {diff === null ? <span className="text-muted-foreground">Isi hasil hitung</span> : diff === 0n ? <span className="text-pass">Sama dengan buku</span> : (
              <span><Money value={diff < 0n ? -diff : diff} currency={v.currency} /> <span className="text-xs text-muted-foreground">{diff > 0n ? "kenaikan: Dr 1160 / Cr 5190" : "penurunan: Dr 5190 / Cr 1160"}</span></span>
            )}
          </dd>
        </div>
      </dl>
      {v.later ? (
        <p className="text-sm text-muted-foreground">Persediaan {v.later} sudah dicatat. Hitungan bulan ini tidak bisa diubah lagi; koreksi lewat bulan itu.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Nilai persediaan hasil stock opname ({v.currency})</span>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="mis. 125.000.000" className="num w-56" disabled={disabled} aria-invalid={amount.trim() !== "" && counted === null} />
          </label>
          <label className="grid min-w-56 flex-1 gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Catatan (opsional)</span>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. Berita acara stock opname 31/8, gudang utama" disabled={disabled} />
          </label>
          <Button onClick={save} disabled={disabled || busy || counted === null}>
            {busy ? "Mencatat…" : v.count ? "Catat ulang" : "Catat persediaan akhir"}
          </Button>
        </div>
      )}
      {amount.trim() !== "" && counted === null && <p className="text-xs text-fail">Nominal tidak terbaca. Tulis dengan titik ribuan, mis. 125.000.000.</p>}
    </div>
  );
}

export function InventoryCard(props: { clientId: string; year: number; month: number; periodLabel: string; rows: InventoryEntityView[]; locked: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Persediaan akhir {props.periodLabel}</CardTitle>
        <CardDescription>
          Metode periodik: pembelian dicatat sebagai beban pokok, lalu nilai stock opname akhir bulan menjadi saldo Persediaan. Selisihnya dijurnal ke 5190 Perubahan Persediaan, sehingga
          beban pokok = persediaan awal + pembelian − persediaan akhir.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y px-0">
        {props.rows.map((v) => <EntityCount key={v.entityId} {...props} v={v} />)}
      </CardContent>
    </Card>
  );
}
