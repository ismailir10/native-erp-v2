"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { stageLedgerAction } from "@/app/actions";
import { cn } from "@/lib/utils";

type Candidate = { sheet: string; mode: "LEDGER" | "NERACA"; dataRows: number };
const FROM_FILE = "__file__";

/** Ledger / Neraca upload: the file is read and checked; nothing is posted until the accountant has seen the checks and mapped accounts. */
export function LedgerImportForm({ clientId, entities }: { clientId: string; entities: { id: string; name: string; currency: string }[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFileState] = useState<File | null>(null);
  const [entityId, setEntityId] = useState<string>(entities.length > 1 ? FROM_FILE : (entities[0]?.id ?? FROM_FILE));
  const [currencyMode, setCurrencyMode] = useState<"FUNCTIONAL" | "CONVERT">("FUNCTIONAL");
  const [date, setDate] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [sheet, setSheet] = useState("");
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const setFile = (f: File | null) => {
    setFileState(f);
    setCandidates(null);
    setSheet("");
  };

  async function submit() {
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.set("clientId", clientId);
    fd.set("file", file);
    if (entityId !== FROM_FILE) fd.set("entityId", entityId);
    fd.set("currencyMode", currencyMode);
    if (date) fd.set("date", date);
    if (sheet) fd.set("sheet", sheet);
    const r = await stageLedgerAction(fd);
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    if (r.candidates) {
      setCandidates(r.candidates);
      setSheet(r.candidates[0]?.sheet ?? "");
      toast.message(`File berisi ${r.candidates.length} tabel. Pilih sheet yang mau diimpor.`);
      return;
    }
    router.push(`/clients/${clientId}/import/ledger/${r.importId}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Unggah buku besar atau neraca</CardTitle>
        <CardDescription>
          Excel atau CSV dari sistem lama (Jurnal, Accurate, Excel sendiri). Buku besar butuh kolom tanggal, kode/nama akun, debit dan kredit. Neraca butuh kode/nama akun
          dan saldo. File diperiksa dulu; belum ada yang dicatat sampai Anda menyetujuinya.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Field>
          <FieldLabel>1. File</FieldLabel>
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
            <span className="text-xs text-muted-foreground">XLSX atau CSV · maks. 5 MB</span>
          </button>
          <input ref={inputRef} type="file" accept=".xlsx,.csv" className="sr-only" data-testid="ledger-file-input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>

        {candidates && (
          <Field>
            <FieldLabel>Sheet</FieldLabel>
            <Select value={sheet} onValueChange={(v) => setSheet(v as string)}>
              <SelectTrigger className="w-full" aria-label="Sheet"><SelectValue /></SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.sheet} value={c.sheet}>
                    {c.sheet} · {c.mode === "LEDGER" ? "buku besar" : "neraca"} · {c.dataRows} baris
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>Satu sheet per impor. Impor sheet lain setelah yang ini dicatat.</FieldDescription>
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel>2. Entitas</FieldLabel>
            <Select value={entityId} onValueChange={(v) => setEntityId(v as string)}>
              <SelectTrigger className="w-full" aria-label="Entitas">
                <SelectValue>{entityId === FROM_FILE ? "Sesuai kolom entitas di file" : entities.find((e) => e.id === entityId)?.name}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {entities.length > 1 && <SelectItem value={FROM_FILE}>Sesuai kolom entitas di file</SelectItem>}
                {entities.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name} · {e.currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>Nilai di kolom entitas dicocokkan dengan nama singkat entitas. Neraca selalu untuk satu entitas.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>3. Baris valas</FieldLabel>
            <Select value={currencyMode} onValueChange={(v) => setCurrencyMode(v as "FUNCTIONAL" | "CONVERT")}>
              <SelectTrigger className="w-full" aria-label="Baris valas">
                <SelectValue>{currencyMode === "FUNCTIONAL" ? "Jumlah sudah dalam mata uang entitas" : "Konversi dengan kurs"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FUNCTIONAL">Jumlah sudah dalam mata uang entitas</SelectItem>
                <SelectItem value="CONVERT">Konversi dengan kurs</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>
              {currencyMode === "FUNCTIONAL"
                ? "Angka dicatat apa adanya; kolom mata uang hanya informasi. Baris valas tanpa kurs ditandai untuk dicek."
                : "Baris valas dikonversi dengan kurs di file, atau kurs di halaman Kurs pada tanggalnya."}
            </FieldDescription>
          </Field>
        </div>
        <Field className="sm:max-w-xs">
          <FieldLabel htmlFor="ledger-date">Tanggal neraca (opsional)</FieldLabel>
          <Input id="ledger-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <FieldDescription>Hanya dipakai kalau file neraca tidak menulis tanggalnya.</FieldDescription>
        </Field>
        <Button onClick={submit} disabled={!file || busy || (candidates !== null && !sheet)}>
          {busy ? <Loader2 className="animate-spin" /> : <FileUp />} Periksa file
        </Button>
      </CardContent>
    </Card>
  );
}
