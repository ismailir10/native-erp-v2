"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { StatusPill } from "@/components/app/status";
import { importOcrDraftAction, saveOcrDraftAction } from "@/app/actions";
import { readAmount } from "@/lib/ocr/amount";
import { PROOF_LABEL, proveRows } from "@/lib/ocr/prove";
import { formatRupiah } from "@/lib/money";
import { cn } from "@/lib/utils";

type Row = { date: string; description: string; debit: string; credit: string; balance: string };
type Draft = { opening: string; closing: string; rows: Row[] };

/** The accountant's side of a scan (I2a): every row's proof by running balance, live as cells are fixed; Impor only when all tie. */
export function OcrReview({ clientId, draftId, imported, openingSource, initial }: { clientId: string; draftId: string; imported: boolean; openingSource: string | null; initial: Draft }) {
  const router = useRouter();
  const fmt = (v: string) => (v === "" ? "" : formatRupiah(BigInt(v), { bare: true }));
  const [d, setD] = useState<Draft>({ opening: fmt(initial.opening), closing: fmt(initial.closing), rows: initial.rows.map((r) => ({ ...r, debit: fmt(r.debit), credit: fmt(r.credit), balance: fmt(r.balance) })) });
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [busy, setBusy] = useState(false);
  const proof = useMemo(
    () => proveRows(d.rows.map((r) => ({ date: r.date, description: r.description, debit: readAmount(r.debit), credit: readAmount(r.credit), balance: readAmount(r.balance) })), readAmount(d.opening), readAmount(d.closing)),
    [d],
  );
  const unreadable = d.rows.some((r) => [r.debit, r.credit, r.balance].some((v) => v.trim() !== "" && readAmount(v) === null)) || [d.opening, d.closing].some((v) => v.trim() !== "" && readAmount(v) === null);
  const set = (i: number, patch: Partial<Row>) => setD({ ...d, rows: d.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const save = async () => {
    const r = await saveOcrDraftAction(clientId, draftId, d);
    if (!r.ok) toast.error(r.error);
    return r.ok;
  };
  const run = async (importToo: boolean) => {
    setBusy(true);
    try {
      if (!(await save())) return;
      if (!importToo) {
        toast.success("Perubahan disimpan");
        router.refresh();
        return;
      }
      const r = await importOcrDraftAction(clientId, draftId);
      if (!r.ok) return toast.error(r.error);
      toast.success(`${r.summary.rows - r.summary.duplicates} transaksi diimpor dari scan`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  const rows = d.rows.map((r, i) => ({ r, i, p: proof.rows[i] })).filter((x) => !onlyProblems || x.p.state !== "OK");
  return (
    <Card data-testid="ocr-review">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Baris dari scan <StatusPill status={proof.importable && !unreadable ? "PASS" : "REVIEW"} label={proof.importable && !unreadable ? "Semua terbukti" : `${proof.problems} perlu dicek`} />
        </CardTitle>
        <CardDescription>Setiap baris terbukti bila saldo sebelumnya + kredit − debet sama dengan saldo yang tercetak. Angka dibaca AI dari gambar; bandingkan dengan scan bila tidak nyambung.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="ocr-opening">Saldo awal</FieldLabel>
            <Input id="ocr-opening" inputMode="decimal" className="num text-right" disabled={imported} value={d.opening} onChange={(e) => setD({ ...d, opening: e.target.value })} />
            <FieldDescription>{openingSource === "PRINTED" ? "Tercetak di scan." : openingSource === "PREVIOUS" ? "Dari saldo akhir impor sebelumnya rekening ini (tidak tercetak di scan)." : openingSource === "MANUAL" ? "Diisi akuntan." : "Isi dari scan atau dari saldo akhir bulan sebelumnya."}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="ocr-closing">Saldo akhir (bila tercetak)</FieldLabel>
            <Input id="ocr-closing" inputMode="decimal" className="num text-right" disabled={imported} value={d.closing} onChange={(e) => setD({ ...d, closing: e.target.value })} />
            <FieldDescription>{proof.closingOk === false ? "Tidak sama dengan saldo baris terakhir." : proof.closingOk ? "Sama dengan saldo baris terakhir." : "Kosongkan bila tidak tercetak."}</FieldDescription>
          </Field>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="ocr-only-problems" checked={onlyProblems} onCheckedChange={(v) => setOnlyProblems(v === true)} />
          <label htmlFor="ocr-only-problems">Tampilkan hanya baris yang perlu dicek</label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="eyebrow py-2 pr-2">#</th>
                <th className="eyebrow py-2 pr-2">Tanggal</th>
                <th className="eyebrow py-2 pr-2">Keterangan</th>
                <th className="eyebrow py-2 pr-2 text-right">Debet</th>
                <th className="eyebrow py-2 pr-2 text-right">Kredit</th>
                <th className="eyebrow py-2 pr-2 text-right">Saldo</th>
                <th className="eyebrow py-2 pr-2">Bukti</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ r, i, p }) => (
                <tr key={i} className={cn("border-b align-top", p.state !== "OK" && "bg-review-subtle/50")} data-testid="ocr-row">
                  <td className="num py-1.5 pr-2 text-muted-foreground">{i + 1}</td>
                  <td className="py-1.5 pr-2"><Input aria-label={`Tanggal baris ${i + 1}`} className="num w-32" disabled={imported} value={r.date} onChange={(e) => set(i, { date: e.target.value })} placeholder="YYYY-MM-DD" /></td>
                  <td className="py-1.5 pr-2"><Input aria-label={`Keterangan baris ${i + 1}`} disabled={imported} value={r.description} onChange={(e) => set(i, { description: e.target.value })} /></td>
                  <td className="py-1.5 pr-2"><Input aria-label={`Debet baris ${i + 1}`} inputMode="decimal" className="num w-32 text-right" disabled={imported} value={r.debit} onChange={(e) => set(i, { debit: e.target.value })} /></td>
                  <td className="py-1.5 pr-2"><Input aria-label={`Kredit baris ${i + 1}`} inputMode="decimal" className="num w-32 text-right" disabled={imported} value={r.credit} onChange={(e) => set(i, { credit: e.target.value })} /></td>
                  <td className="py-1.5 pr-2"><Input aria-label={`Saldo baris ${i + 1}`} inputMode="decimal" className="num w-36 text-right" disabled={imported} value={r.balance} onChange={(e) => set(i, { balance: e.target.value })} /></td>
                  <td className="py-1.5 pr-2">
                    <StatusPill status={p.state === "OK" ? "PASS" : "REVIEW"} label={PROOF_LABEL[p.state]} />
                    {p.state === "BREAK" && p.expected !== null && <div className="num mt-1 text-xs text-muted-foreground">Hitungan: {formatRupiah(p.expected, { bare: true })}</div>}
                  </td>
                  <td className="py-1.5">
                    {!imported && (
                      <Button variant="ghost" size="icon-sm" aria-label={`Hapus baris ${i + 1}`} onClick={() => setD({ ...d, rows: d.rows.filter((_, j) => j !== i) })}>
                        <Trash2 />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!imported && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setD({ ...d, rows: [...d.rows, { date: d.rows.at(-1)?.date ?? "", description: "", debit: "", credit: "", balance: "" }] })}>
              <Plus /> Tambah baris
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => run(false)}>Simpan perubahan</Button>
            <Button disabled={busy || !proof.importable || unreadable} onClick={() => run(true)}>Impor {d.rows.length} transaksi</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
