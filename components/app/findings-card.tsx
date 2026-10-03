"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { AccountPicker, type AccountOption } from "@/components/app/account-picker";
import { Money } from "@/components/app/money";
import { StatusPill } from "@/components/app/status";
import { resolveFindingAction } from "@/app/actions";
import Link from "next/link";

export type FindingItem = {
  id: string;
  kind: "OPENING_DIFFERENCE" | "SUBLEDGER_DIFFERENCE";
  /** Where a subledger difference is explained (Piutang & Utang → Rekonsiliasi). */
  href?: string;
  label: string;
  entity: string;
  currency: string;
  /** Signed minor units as a string: debit +, credit − on 3290. */
  amount: string;
  date: string;
  question: string;
  status: "OPEN" | "RESOLVED";
  opened: string;
  resolution: string | null;
  resolved: string | null;
  resolvedTo: string | null;
};

const DECISION_MIN = 10;

/**
 * Temuan (ADR 0012): differences Buku does not plug. An open one holds the close until the accountant writes where the difference
 * belongs and picks the account; the resolution is posted at the Saldo Awal date and kept with who and when.
 */
export function FindingsCard({ clientId, items, accounts }: { clientId: string; items: FindingItem[]; accounts: AccountOption[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, { code: string; decision: string }>>({});
  const open = items.filter((f) => f.status === "OPEN").length;
  const of = (id: string) => form[id] ?? { code: "", decision: "" };
  const set = (id: string, patch: Partial<{ code: string; decision: string }>) => setForm((x) => ({ ...x, [id]: { ...of(id), ...patch } }));

  async function resolve(f: FindingItem) {
    const v = of(f.id);
    setBusy(f.id);
    try {
      const r = await resolveFindingAction({ clientId, findingId: f.id, accountCode: v.code, decision: v.decision });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${f.label} diselesaikan`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card data-testid="findings">
      <CardHeader>
        <CardTitle>Temuan {open ? `· ${open} terbuka` : ""}</CardTitle>
        <CardDescription>
          Selisih yang tidak diseimbangkan otomatis. Temuan terbuka menahan tutup buku sampai Anda menulis asal selisihnya dan memilih akunnya.
          Penyelesaian dicatat per tanggal saldo awal dan disimpan bersama nama dan waktunya.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {items.map((f) => {
          const amount = BigInt(f.amount);
          const v = of(f.id);
          return (
            <div key={f.id} className="space-y-2 border-t pt-4 first:border-t-0 first:pt-0" data-testid="finding">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-medium">{f.label}</span>
                <StatusPill status={f.status === "OPEN" ? "FAIL" : "PASS"} label={f.status === "OPEN" ? "Terbuka" : "Selesai"} />
                <span className="text-sm text-muted-foreground">{f.entity} · {f.kind === "SUBLEDGER_DIFFERENCE" ? "selisih aging vs buku besar" : "selisih saldo awal"} per {f.date}</span>
                <Money className="ml-auto text-sm font-medium" value={amount < 0n ? -amount : amount} currency={f.currency} />
              </div>
              <p className="text-sm">{f.question}</p>
              <p className="text-xs text-muted-foreground">Dibuka {f.opened}</p>
              {f.kind === "SUBLEDGER_DIFFERENCE" && f.status === "OPEN" ? (
                <p className="text-sm">
                  <Link href={f.href ?? "#"} className="text-primary underline-offset-4 hover:underline">Jelaskan di Piutang &amp; Utang → Rekonsiliasi</Link>
                  <span className="text-muted-foreground"> · tidak menahan tutup buku, tampil sebagai kontrol “Perlu dicek”.</span>
                </p>
              ) : f.status === "RESOLVED" ? (
                <div className="rounded-md border px-3 py-2 text-sm" data-testid="finding-resolution">
                  <div><span className="text-muted-foreground">Keputusan:</span> {f.resolution}</div>
                  <div className="text-xs text-muted-foreground">
                    {f.kind === "SUBLEDGER_DIFFERENCE" ? "Dijelaskan" : f.resolvedTo ? `Dipindahkan ke ${f.resolvedTo}` : "Selisihnya sudah dikoreksi lewat jurnal lain"} · {f.resolved}
                  </div>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)_auto] md:items-start">
                  <Field>
                    <FieldLabel>Akun tujuan</FieldLabel>
                    <AccountPicker ariaLabel={`Akun tujuan ${f.label}`} value={v.code} onChange={(code) => set(f.id, { code })} options={accounts} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`decision-${f.id}`}>Keputusan</FieldLabel>
                    <Textarea id={`decision-${f.id}`} rows={2} value={v.decision} onChange={(e) => set(f.id, { decision: e.target.value })} placeholder="Mis. kas kecil di brankas, dikonfirmasi pemilik 2 Okt 2026" />
                    <FieldDescription>Dari mana selisihnya dan siapa yang mengonfirmasi (min. {DECISION_MIN} karakter).</FieldDescription>
                  </Field>
                  <Button variant="outline" className="md:mt-6" disabled={busy !== null || !v.code || v.decision.trim().length < DECISION_MIN} onClick={() => resolve(f)}>
                    {busy === f.id ? "Menyimpan…" : `Selesaikan ${f.label}`}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
