"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, FileUp, Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { StatusPill } from "@/components/app/status";
import { importAction, importSampleAction } from "@/app/actions";
import type { ImportSummary } from "@/lib/import/pipeline";
import { cn } from "@/lib/utils";

type BankOption = { id: string; label: string; entity: string; bank: string; number: string };

const METHOD_LABEL: Record<string, string> = { TRANSFER: "Transfer antar rekening", RULE: "Aturan", MEMORY: "Memori (pernah dikonfirmasi)", AI: "Usulan AI", HEURISTIC: "Tebakan sederhana", MANUAL: "Manual" };

export function ImportForm({ clientId, banks, sample }: { clientId: string; banks: BankOption[]; sample?: { bankAccountId: string; fileName: string } }) {
  const router = useRouter();
  const [bankId, setBankId] = useState<string>(sample?.bankAccountId ?? banks[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const entities = [...new Set(banks.map((b) => b.entity))];

  const done = (r: Awaited<ReturnType<typeof importAction>>) => {
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setResult(r.summary);
    setFile(null);
    toast.success(`${r.summary.rows - r.summary.duplicates} transaksi diproses`);
    router.refresh();
  };

  const submit = () =>
    start(async () => {
      if (!file) return;
      const fd = new FormData();
      fd.set("clientId", clientId);
      fd.set("bankAccountId", bankId);
      fd.set("file", file);
      done(await importAction(fd));
    });

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>Unggah rekening koran</CardTitle>
          <CardDescription>CSV KlikBCA, Excel Mandiri, CSV BRI, atau file lain dengan kolom tanggal/keterangan/debet/kredit/saldo.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Field>
            <FieldLabel>1. Rekening</FieldLabel>
            <Select value={bankId} onValueChange={(v) => setBankId(v as string)}>
              <SelectTrigger className="w-full" aria-label="Rekening">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {entities.map((e) => (
                  <SelectGroup key={e}>
                    <SelectLabel>{e}</SelectLabel>
                    {banks.filter((b) => b.entity === e).map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.label} · {b.number}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>2. File mutasi</FieldLabel>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                setFile(e.dataTransfer.files[0] ?? null);
              }}
              className={cn(
                "flex w-full flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-sm transition-colors",
                drag ? "border-primary bg-primary-subtle" : "border-input bg-muted/40 hover:bg-muted",
              )}
            >
              <FileUp className="size-6 text-primary" aria-hidden />
              {file ? <span className="font-medium">{file.name}</span> : <span><span className="font-medium text-primary">Pilih file</span> atau tarik ke sini</span>}
              <span className="text-xs text-muted-foreground">Maks. 5 MB · baris yang sudah pernah diimpor otomatis dilewati</span>
            </button>
            <input ref={inputRef} type="file" accept=".csv,.xlsx" className="sr-only" data-testid="file-input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <FieldDescription>Kami cek saldo berjalan tiap baris — kalau ada baris hilang, Anda akan diberi tahu.</FieldDescription>
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={submit} disabled={!file || !bankId || pending}>
              {pending ? <Loader2 className="animate-spin" /> : <FileUp />} Proses mutasi
            </Button>
            {sample && (
              <Button variant="outline" disabled={pending} onClick={() => start(async () => done(await importSampleAction(clientId, sample.bankAccountId)))}>
                <FileText /> Pakai file contoh ({sample.fileName})
              </Button>
            )}
            {sample && (
              <a href={`/demo/${sample.fileName}`} download className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                atau unduh untuk dicoba tarik-lepas
              </a>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2" data-testid="import-result">
        <CardHeader>
          <CardTitle>Hasil</CardTitle>
          <CardDescription>{result ? "Setiap baris sudah dijurnal. Yang belum yakin masuk antrian review." : "Hasil klasifikasi muncul di sini."}</CardDescription>
        </CardHeader>
        <CardContent>
          {result ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-muted p-2"><div className="num text-xl font-semibold">{result.rows - result.duplicates}</div><div className="text-xs text-muted-foreground">baris baru</div></div>
                <div className="rounded-md bg-pass-subtle p-2 text-pass"><div className="num text-xl font-semibold">{result.posted}</div><div className="text-xs">langsung dijurnal</div></div>
                <div className="rounded-md bg-review-subtle p-2 text-review"><div className="num text-xl font-semibold">{result.needsReview}</div><div className="text-xs">perlu review</div></div>
              </div>
              <ul className="space-y-1">
                {Object.entries(result.byMethod).filter(([, n]) => n > 0).map(([m, n]) => (
                  <li key={m} className="flex justify-between"><span className="text-muted-foreground">{METHOD_LABEL[m]}</span><span className="num font-medium">{n}</span></li>
                ))}
              </ul>
              <div className="flex items-center justify-between border-t pt-3">
                <span className="text-muted-foreground">Kesinambungan saldo</span>
                <StatusPill status={result.continuityOk ? "PASS" : "REVIEW"} label={result.continuityOk ? "Nyambung" : "Ada celah"} />
              </div>
              {result.continuityNote && <p className="text-xs text-review">{result.continuityNote}</p>}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Panggilan AI</span>
                <span className="num">{result.ai.calls} panggilan · {result.ai.cacheHits} dari cache</span>
              </div>
              {result.ai.note && <p className="text-xs text-muted-foreground">{result.ai.note}</p>}
              {result.duplicates > 0 && <p className="text-xs text-muted-foreground">{result.duplicates} baris dilewati karena sudah pernah diimpor.</p>}
              {result.needsReview > 0 ? (
                <Link href={`/clients/${clientId}/review`} className={buttonVariants({ className: "w-full" })}>
                  Review {result.needsReview} transaksi
                </Link>
              ) : (
                <Link href={`/clients/${clientId}/close`} className={buttonVariants({ variant: "outline", className: "w-full" })}>
                  Lanjut ke Tutup Buku
                </Link>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Belum ada file yang diproses di sesi ini.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
