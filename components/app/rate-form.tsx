"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deleteRateAction, saveRateAction } from "@/app/actions";
import { CURRENCY_CODES, CURRENCIES, formatRateId, normalizeRateInput } from "@/lib/fx/currency";

type Missing = { currency: string; quote: string; kind: "SPOT" | "AVERAGE"; date: string; label: string };

export function RateForm({ clientId, defaultCurrency, missing }: { clientId: string; defaultCurrency: string; missing: Missing[] }) {
  const router = useRouter();
  const first = missing[0];
  const [currency, setCurrency] = useState(first?.currency ?? defaultCurrency);
  const [quote, setQuote] = useState(first?.quote ?? "IDR");
  const [date, setDate] = useState(first?.date ?? "");
  const [kind, setKind] = useState<string>(first?.kind ?? "SPOT");
  const [rate, setRate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const fill = (m: Missing) => {
    setCurrency(m.currency);
    setQuote(m.quote);
    setDate(m.date);
    setKind(m.kind);
    setRate("");
  };

  async function save() {
    setBusy(true);
    const res = await saveRateAction({ clientId, currency, quote, date, kind, rate, note });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`Kurs ${currency}→${quote} disimpan`);
    setRate("");
    setNote("");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Isi yang belum ada:</span>
          {missing.slice(0, 8).map((m) => (
            <Button key={`${m.currency}-${m.kind}-${m.date}`} variant="outline" size="sm" onClick={() => fill(m)}>
              {m.label}
            </Button>
          ))}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field>
          <FieldLabel>Dari</FieldLabel>
          <Select value={currency} onValueChange={(v) => setCurrency(v as string)}>
            <SelectTrigger className="w-full" aria-label="Mata uang asal"><SelectValue /></SelectTrigger>
            <SelectContent>{CURRENCY_CODES.map((c) => <SelectItem key={c} value={c}>{c} · {CURRENCIES[c].name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>Ke</FieldLabel>
          <Select value={quote} onValueChange={(v) => setQuote(v as string)}>
            <SelectTrigger className="w-full" aria-label="Mata uang tujuan"><SelectValue /></SelectTrigger>
            <SelectContent>{CURRENCY_CODES.map((c) => <SelectItem key={c} value={c}>{c} · {CURRENCIES[c].name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>Tanggal</FieldLabel>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel>Jenis</FieldLabel>
          <Select value={kind} onValueChange={(v) => setKind(v as string)}>
            <SelectTrigger className="w-full" aria-label="Jenis kurs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="SPOT">Spot (penutup)</SelectItem>
              <SelectItem value="AVERAGE">Rata-rata</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>Kurs (1 {currency} = … {quote})</FieldLabel>
          <Input inputMode="decimal" className="num text-right" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={quote === "IDR" ? "12250" : "1.31"} />
        </Field>
        <Field>
          <FieldLabel>Sumber (opsional)</FieldLabel>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. Kurs tengah BI" />
        </Field>
      </div>
      <p className="num text-sm text-muted-foreground" aria-live="polite">{preview(rate, currency, quote)}</p>
      <Button onClick={save} disabled={busy}>
        {busy ? "Menyimpan…" : "Simpan kurs"}
      </Button>
    </div>
  );
}

function preview(rate: string, currency: string, quote: string) {
  if (!rate.trim()) return "Contoh: 1 SGD = 12.250 IDR ditulis 12250 atau 12.250.";
  try {
    return `Dibaca sebagai: 1 ${currency} = ${formatRateId(normalizeRateInput(rate))} ${quote}`;
  } catch {
    return "Kurs harus angka positif.";
  }
}

export function RateRowActions({ clientId, rateId, label }: { clientId: string; rateId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Hapus kurs ${label}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await deleteRateAction(clientId, rateId);
        setBusy(false);
        if (!res.ok) return toast.error(res.error);
        toast.success(`Kurs ${label} dihapus`);
        router.refresh();
      }}
    >
      <Trash2 className="size-4" />
    </Button>
  );
}
