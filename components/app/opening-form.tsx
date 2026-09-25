"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { openingAction } from "@/app/actions";
import { formatMoney, moneyExample, parseMoney } from "@/lib/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Line = { accountCode: string; debit: string; credit: string };
type BankLine = { accountCode: string; label: string; prefill: string; source: string | null };

/** Typed amount → minor units, or the Bahasa reason it can't be read. */
const read = (s: string, currency: string): { value: bigint; error?: undefined } | { value: 0n; error: string } => {
  try {
    return { value: parseMoney(s, currency) };
  } catch (e) {
    return { value: 0n, error: (e as Error).message };
  }
};

/**
 * One entity's opening balances. Bank lines come first (prefilled from the first statement), then any other
 * balances (receivables, fixed assets, loans…). The difference is shown as the 3200 Saldo Laba plug.
 * Amounts are typed in major units of the entity's `currency`; the server parses them the same way.
 */
export function OpeningForm({
  clientId,
  entityId,
  currency,
  suggestedDate,
  banks,
  accounts,
}: {
  clientId: string;
  entityId: string;
  currency: string;
  suggestedDate: string;
  banks: BankLine[];
  accounts: { code: string; name: string }[];
}) {
  const router = useRouter();
  const [date, setDate] = useState(suggestedDate);
  const [bankBalances, setBankBalances] = useState(banks.map((b) => b.prefill));
  const [others, setOthers] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);

  const cur = currency === "IDR" ? "" : ` (${currency})`;
  const bankParsed = bankBalances.map((v) => read(v, currency));
  const otherParsed = others.map((l) => ({ debit: read(l.debit, currency), credit: read(l.credit, currency) }));
  const error = [...bankParsed.map((p) => p.error), ...otherParsed.flatMap((p) => [p.debit.error, p.credit.error])].find(Boolean);
  // A bank balance is an asset: positive = debit, negative (overdraft) = credit. Sent back in the same major-unit
  // notation the server parses, never as raw minor units.
  const bankLines: Line[] = banks.map((b, i) => {
    const v = bankParsed[i].value;
    const major = formatMoney(v < 0n ? -v : v, currency, { bare: true });
    return { accountCode: b.accountCode, debit: v > 0n ? major : "", credit: v < 0n ? major : "" };
  });
  const lines = [...bankLines, ...others];
  const dr = bankParsed.reduce((s, p) => s + (p.value > 0n ? p.value : 0n), 0n) + otherParsed.reduce((s, p) => s + p.debit.value, 0n);
  const cr = bankParsed.reduce((s, p) => s + (p.value < 0n ? -p.value : 0n), 0n) + otherParsed.reduce((s, p) => s + p.credit.value, 0n);
  const plug = dr - cr;
  const setOther = (i: number, patch: Partial<Line>) => setOthers((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function submit() {
    setBusy(true);
    try {
      const r = await openingAction({ clientId, entityId, date, lines });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Saldo awal tersimpan");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Field className="max-w-xs">
        <FieldLabel htmlFor={`opening-date-${entityId}`}>Per tanggal</FieldLabel>
        <Input id={`opening-date-${entityId}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <FieldDescription>Sehari sebelum transaksi pertama yang akan diimpor.</FieldDescription>
      </Field>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="p-2 pl-3 text-left font-medium">Akun</TableHead>
              <TableHead className="p-2 text-right font-medium">Debit{cur}</TableHead>
              <TableHead className="p-2 text-right font-medium">Kredit{cur}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {banks.map((b, i) => (
              <TableRow key={b.accountCode} className="border-t">
                <TableCell className="p-2 pl-3">
                  <div className="font-medium">{b.accountCode} {b.label}</div>
                  <div className="text-xs text-muted-foreground">{b.source ?? "Belum ada rekening koran. Isi saldo dari rekening koran bulan sebelumnya."}</div>
                </TableCell>
                <TableCell className="p-2" colSpan={2}>
                  <Input
                    aria-label={`Saldo ${b.label}`}
                    aria-invalid={!!bankParsed[i].error || undefined}
                    inputMode="decimal"
                    className="num text-right"
                    value={bankBalances[i]}
                    onChange={(e) => setBankBalances((vs) => vs.map((v, j) => (j === i ? e.target.value : v)))}
                    placeholder={`Saldo di bank, mis. ${moneyExample(currency)}`}
                  />
                </TableCell>
                <TableCell />
              </TableRow>
            ))}
            {others.map((l, i) => (
              <TableRow key={i} className="border-t">
                <TableCell className="p-2 pl-3">
                  <Select value={l.accountCode} onValueChange={(v) => setOther(i, { accountCode: v as string })}>
                    <SelectTrigger className="w-full min-w-64" aria-label={`Akun baris ${i + 1}`}><SelectValue placeholder="Pilih akun" /></SelectTrigger>
                    <SelectContent>{accounts.map((a) => <SelectItem key={a.code} value={a.code}>{a.code} {a.name}</SelectItem>)}</SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="p-2"><Input aria-label="Debit" aria-invalid={!!otherParsed[i].debit.error || undefined} inputMode="decimal" className="num text-right" value={l.debit} onChange={(e) => setOther(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} placeholder={formatMoney(0n, currency, { bare: true })} /></TableCell>
                <TableCell className="p-2"><Input aria-label="Kredit" aria-invalid={!!otherParsed[i].credit.error || undefined} inputMode="decimal" className="num text-right" value={l.credit} onChange={(e) => setOther(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} placeholder={formatMoney(0n, currency, { bare: true })} /></TableCell>
                <TableCell className="p-2"><Button variant="ghost" size="icon-sm" aria-label="Hapus baris" onClick={() => setOthers((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button></TableCell>
              </TableRow>
            ))}
            <TableRow className="border-t text-muted-foreground">
              <TableCell className="p-2 pl-3">3200 Saldo Laba <span className="text-xs">· penyeimbang otomatis</span></TableCell>
              <TableCell className="num p-2 pr-5 text-right">{plug < 0n ? formatMoney(-plug, currency, { bare: true }) : "–"}</TableCell>
              <TableCell className="num p-2 pr-5 text-right">{plug > 0n ? formatMoney(plug, currency, { bare: true }) : "–"}</TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={submit} disabled={busy || !!error || (dr === 0n && cr === 0n)}>
          {busy ? "Menyimpan…" : "Simpan saldo awal"}
        </Button>
        <Button variant="outline" onClick={() => setOthers((ls) => [...ls, { accountCode: "", debit: "", credit: "" }])}>
          <Plus /> Tambah akun lain
        </Button>
        <span className="text-xs text-muted-foreground">Piutang, persediaan, aset tetap, utang, modal. Kosongkan kalau belum ada datanya.</span>
      </div>
    </div>
  );
}
