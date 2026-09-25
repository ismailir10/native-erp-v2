"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/app/status";
import { adjustmentAction } from "@/app/actions";
import { formatRupiah, parseRupiah } from "@/lib/money";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Line = { accountCode: string; debit: string; credit: string };
const safe = (s: string) => {
  try {
    return parseRupiah(s);
  } catch {
    return 0n;
  }
};

const TEMPLATES: { label: string; memo: string; lines: Line[] }[] = [
  { label: "Penyusutan", memo: "Penyusutan aset tetap bulanan", lines: [{ accountCode: "6180", debit: "", credit: "" }, { accountCode: "1219", debit: "", credit: "" }] },
  { label: "Akrual beban", memo: "Akrual beban yang belum dibayar", lines: [{ accountCode: "6190", debit: "", credit: "" }, { accountCode: "2150", debit: "", credit: "" }] },
  { label: "Piutang usaha", memo: "Pengakuan piutang atas penjualan belum dibayar", lines: [{ accountCode: "1130", debit: "", credit: "" }, { accountCode: "4100", debit: "", credit: "" }] },
];

export function JournalForm({ clientId, entities, accounts, defaultDate }: { clientId: string; entities: { id: string; name: string }[]; accounts: { code: string; name: string }[]; defaultDate: string }) {
  const router = useRouter();
  const [entityId, setEntityId] = useState(entities[0]?.id ?? "");
  const [date, setDate] = useState(defaultDate);
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<Line[]>([{ accountCode: "", debit: "", credit: "" }, { accountCode: "", debit: "", credit: "" }]);
  const [pending, start] = useTransition();
  const dr = lines.reduce((s, l) => s + safe(l.debit), 0n);
  const cr = lines.reduce((s, l) => s + safe(l.credit), 0n);
  const balanced = dr === cr && dr > 0n;
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <span className="self-center text-sm text-muted-foreground">Template:</span>
        {TEMPLATES.map((t) => (
          <Button key={t.label} variant="outline" size="sm" onClick={() => { setMemo(t.memo); setLines(t.lines.map((l) => ({ ...l }))); }}>{t.label}</Button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field>
          <FieldLabel>Entitas</FieldLabel>
          <Select value={entityId} onValueChange={(v) => setEntityId(v as string)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{entities.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>Tanggal</FieldLabel>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel>Keterangan</FieldLabel>
          <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="mis. Penyusutan Agustus" />
        </Field>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow><TableHead className="p-2 pl-3 text-left font-medium">Akun</TableHead><TableHead className="p-2 text-right font-medium">Debit</TableHead><TableHead className="p-2 text-right font-medium">Kredit</TableHead><TableHead className="w-10" /></TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l, i) => (
              <TableRow key={i} className="border-t">
                <TableCell className="p-2 pl-3">
                  <Select value={l.accountCode} onValueChange={(v) => setLine(i, { accountCode: v as string })}>
                    <SelectTrigger className="w-full min-w-64" aria-label={`Akun baris ${i + 1}`}><SelectValue placeholder="Pilih akun" /></SelectTrigger>
                    <SelectContent>{accounts.map((a) => <SelectItem key={a.code} value={a.code}>{a.code} {a.name}</SelectItem>)}</SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="p-2"><Input inputMode="numeric" className="num text-right" value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} placeholder="0" /></TableCell>
                <TableCell className="p-2"><Input inputMode="numeric" className="num text-right" value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} placeholder="0" /></TableCell>
                <TableCell className="p-2">{lines.length > 2 && <Button variant="ghost" size="icon-sm" aria-label="Hapus baris" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="p-2 pl-3"><Button variant="ghost" size="sm" onClick={() => setLines((ls) => [...ls, { accountCode: "", debit: "", credit: "" }])}><Plus /> Tambah baris</Button></TableCell>
              <TableCell className="num p-2 text-right font-semibold">{formatRupiah(dr, { bare: true })}</TableCell>
              <TableCell className="num p-2 text-right font-semibold">{formatRupiah(cr, { bare: true })}</TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusPill status={balanced ? "PASS" : "REVIEW"} label={balanced ? "Seimbang" : dr === cr ? "Isi nominal" : `Selisih ${formatRupiah(dr - cr)}`} />
        <Button
          disabled={!balanced || pending}
          onClick={() =>
            start(async () => {
              const r = await adjustmentAction({ clientId, entityId, date, memo, lines });
              if (!r.ok) return void toast.error(r.error);
              toast.success("Jurnal penyesuaian tersimpan");
              setMemo("");
              setLines([{ accountCode: "", debit: "", credit: "" }, { accountCode: "", debit: "", credit: "" }]);
              router.refresh();
            })
          }
        >
          Simpan jurnal
        </Button>
      </div>
    </div>
  );
}
