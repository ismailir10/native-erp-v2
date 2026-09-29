"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SimpleSelect } from "@/components/app/simple-select";
import { Money } from "@/components/app/money";
import { postCkpnAction, saveCkpnSettingAction } from "@/app/actions";
import type { CkpnView } from "@/lib/receivables/ckpn";

/** CKPN piutang usaha (PSAK 109, accounting-rules 5e): the provision matrix of one entity, its setting and the allowance journal. */
export function CkpnCard(props: { clientId: string; year: number; month: number; periodKey: string; periodLabel: string; view: CkpnView }) {
  const router = useRouter();
  const v = props.view;
  const cur = v.currency;
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(v.setting);
  const dirty = JSON.stringify(form) !== JSON.stringify(v.setting) || !v.setting.saved;
  const diff = v.difference === null ? null : BigInt(v.difference);
  const manual = form.method === "MANUAL";

  const run = async (action: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) => {
    setBusy(true);
    const r = await action();
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(done);
    router.refresh();
  };
  const pct = (key: "forward" | "lastBucket", label: string, hint?: string) => (
    <Field>
      <FieldLabel htmlFor={`ckpn-${key}-${v.entityId}`}>{label}</FieldLabel>
      <div className="flex items-center gap-1">
        <Input id={`ckpn-${key}-${v.entityId}`} inputMode="decimal" className="num w-24 text-right" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
        <span className="text-muted-foreground">%</span>
      </div>
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </Field>
  );

  return (
    <Card data-testid={`ckpn-${v.entityId}`}>
      <CardHeader>
        <CardTitle>CKPN piutang usaha (PSAK 109) · {v.entity}</CardTitle>
        <CardDescription>
          Matriks provisi dari umur piutang: saldo per umur × tarif kerugian × faktor forward-looking. Jurnalnya membawa 1135 Cadangan Kerugian Penurunan Nilai Piutang ke angka ini, lawannya 6185.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field>
            <FieldLabel>Metode tarif kerugian</FieldLabel>
            <SimpleSelect label="Metode tarif kerugian" value={form.method} onChange={(m) => setForm({ ...form, method: m as CkpnView["setting"]["method"] })} options={[{ value: "ROLL_RATE", label: "Roll rate dari umur piutang" }, { value: "MANUAL", label: "Manual per umur" }]} />
          </Field>
          {!manual && (
            <Field>
              <FieldLabel htmlFor={`ckpn-history-${v.entityId}`}>Riwayat (bulan)</FieldLabel>
              <div>
                <Input id={`ckpn-history-${v.entityId}`} inputMode="numeric" className="num w-24 text-right" value={String(form.historyMonths)} onChange={(e) => setForm({ ...form, historyMonths: Number(e.target.value.replace(/\D/g, "")) })} />
              </div>
            </Field>
          )}
          {pct("lastBucket", "Tarif kerugian > 90 hari")}
          {pct("forward", "Faktor forward-looking", "100% = tanpa penyesuaian makro")}
        </div>
        {manual && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {v.rows.slice(0, 4).map((r, i) => (
              <Field key={r.bucket}>
                <FieldLabel htmlFor={`ckpn-manual-${i}-${v.entityId}`}>{r.label}</FieldLabel>
                <div className="flex items-center gap-1">
                  <Input
                    id={`ckpn-manual-${i}-${v.entityId}`}
                    inputMode="decimal"
                    className="num w-24 text-right"
                    value={form.manual[i]}
                    onChange={(e) => setForm({ ...form, manual: form.manual.map((m, k) => (k === i ? e.target.value : m)) as CkpnView["setting"]["manual"] })}
                  />
                  <span className="text-muted-foreground">%</span>
                </div>
              </Field>
            ))}
          </div>
        )}
        {v.effectiveFrom && <p className="text-xs text-muted-foreground">Pengaturan berlaku sejak {v.effectiveFrom}. Menyimpan perubahan di sini berlaku mulai {props.periodLabel}; bulan sebelumnya tetap memakai pengaturan lamanya.</p>}
        {dirty && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => saveCkpnSettingAction({ clientId: props.clientId, entityId: v.entityId, year: props.year, month: props.month, ...form }), "Pengaturan CKPN disimpan")}>
            Simpan pengaturan
          </Button>
        )}

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[320px] text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-2 sm:px-3 py-2 text-left font-medium">Umur piutang</th>
                <th className="px-2 sm:px-3 py-2 text-right font-medium">Saldo {props.periodLabel}</th>
                {v.setting.method === "ROLL_RATE" && <th className="hidden px-2 sm:px-3 py-2 text-right font-medium sm:table-cell">Roll rate</th>}
                <th className="px-2 sm:px-3 py-2 text-right font-medium">Tarif kerugian</th>
                <th className="px-2 sm:px-3 py-2 text-right font-medium">CKPN</th>
              </tr>
            </thead>
            <tbody>
              {v.rows.map((r, i) => (
                <tr key={r.bucket} className="border-t" data-testid={`ckpn-row-${r.bucket}`}>
                  <td className="px-2 sm:px-3 py-1.5">{r.label}</td>
                  <td className="px-2 sm:px-3 py-1.5 text-right"><Money value={BigInt(r.open)} currency={cur} /></td>
                  {v.setting.method === "ROLL_RATE" && (
                    <td className="num hidden px-2 sm:px-3 py-1.5 text-right text-muted-foreground sm:table-cell" title={r.samples ? `rata-rata ${r.samples} bulan` : undefined}>
                      {i === v.rows.length - 1 ? "—" : (r.roll ?? "belum ada")}
                    </td>
                  )}
                  <td className="num px-2 sm:px-3 py-1.5 text-right">{r.rate ?? "—"}</td>
                  <td className="px-2 sm:px-3 py-1.5 text-right">{r.amount === null ? "—" : <Money value={BigInt(r.amount)} currency={cur} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {v.snapshots && (
          <p className="text-xs text-muted-foreground">
            Roll rate dari umur piutang {v.snapshots.count} akhir bulan ({v.snapshots.first} – {v.snapshots.last}), faktur per faktur: bagian yang masih terbuka saat umurnya naik.
          </p>
        )}

        {v.blocker ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900" data-testid="ckpn-blocker">{v.blocker}</p>
        ) : (
          <div className="max-w-md">
            <div className="flex items-baseline justify-between gap-4 py-1.5 font-medium" data-testid="ckpn-total">
              <span>CKPN per {props.periodLabel}</span>
              <Money strong value={BigInt(v.total!)} currency={cur} />
            </div>
            <div className="flex items-baseline justify-between gap-4 py-1.5">
              <Link href={`/clients/${props.clientId}/ledger/1135?entity=${v.entityId}&period=${props.periodKey}`} className="hover:text-primary">Cadangan di buku besar (1135)</Link>
              <Money value={BigInt(v.balance)} currency={cur} />
            </div>
            <div className="flex items-baseline justify-between gap-4 border-t py-1.5" data-testid="ckpn-difference">
              <span>{diff! > 0n ? "Perlu ditambah" : diff! < 0n ? "Perlu dipulihkan" : "Selisih"}</span>
              <Money value={diff! < 0n ? -diff! : diff!} currency={cur} />
            </div>
          </div>
        )}
        {v.later ? (
          <p className="text-muted-foreground">Cadangan kerugian sudah dijurnal per {v.later}. Buka bulan itu atau sesudahnya untuk mencatat perubahan.</p>
        ) : diff !== null && diff !== 0n ? (
          <div className="space-y-2">
            <div className="max-w-md rounded-md border">
              {(diff > 0n ? [["6185 Beban Kerugian Penurunan Nilai Piutang", "Debit"], ["1135 Cadangan Kerugian Penurunan Nilai Piutang", "Kredit"]] : [["1135 Cadangan Kerugian Penurunan Nilai Piutang", "Debit"], ["6185 Beban Kerugian Penurunan Nilai Piutang", "Kredit"]]).map(([account, side]) => (
                <div key={account} className="flex items-baseline justify-between gap-4 border-b px-3 py-1.5 last:border-b-0">
                  <span className="min-w-0">{account}</span>
                  <span className="shrink-0 text-muted-foreground">{side}</span>
                </div>
              ))}
            </div>
            <Button disabled={busy || !v.setting.saved || dirty} onClick={() => run(() => postCkpnAction({ clientId: props.clientId, entityId: v.entityId, year: props.year, month: props.month }), "Jurnal CKPN dicatat")}>
              Catat jurnal CKPN per {props.periodLabel}
            </Button>
            {!v.setting.saved && <p className="text-xs text-muted-foreground">Simpan pengaturan dulu; angkanya ikut pengaturan itu.</p>}
          </div>
        ) : diff === 0n && v.setting.saved ? (
          <p className="text-muted-foreground">Cadangan di buku besar sudah sesuai matriks.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
