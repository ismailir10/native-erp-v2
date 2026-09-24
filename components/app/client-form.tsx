"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addClientAction } from "@/app/actions";

type Kind = "PT" | "CV" | "PERORANGAN";
type Bank = "BCA" | "MANDIRI" | "BRI" | "GENERIC";
type BankRow = { bank: Bank; number: string; label: string };
type EntityRow = { name: string; shortName: string; kind: Kind; npwp: string; banks: BankRow[] };

const KIND_LABEL: Record<Kind, string> = { PT: "PT", CV: "CV", PERORANGAN: "Perorangan (pemilik)" };
const BANK_LABEL: Record<Bank, string> = { BCA: "BCA", MANDIRI: "Mandiri", BRI: "BRI", GENERIC: "Bank lain" };
const newBank = (): BankRow => ({ bank: "BCA", number: "", label: "" });
const newEntity = (kind: Kind): EntityRow => ({ name: "", shortName: "", kind, npwp: "", banks: [newBank()] });

export function ClientForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [entities, setEntities] = useState<EntityRow[]>([newEntity("PT")]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // The first entity's name follows the client name until the user types their own (the common case is one PT).
  const [firstNameTouched, setFirstNameTouched] = useState(false);

  const clearError = (...paths: string[]) =>
    setErrors((es) => (paths.some((p) => p in es) ? Object.fromEntries(Object.entries(es).filter(([k]) => !paths.includes(k))) : es));
  const setEntity = (i: number, patch: Partial<EntityRow>) => {
    setEntities((es) => es.map((e, j) => (j === i ? { ...e, ...patch } : e)));
    clearError(...Object.keys(patch).map((k) => `entities.${i}.${k}`));
  };
  const setBank = (i: number, k: number, patch: Partial<BankRow>) => {
    setEntities((es) => es.map((e, j) => (j === i ? { ...e, banks: e.banks.map((b, m) => (m === k ? { ...b, ...patch } : b)) } : e)));
    clearError(...Object.keys(patch).map((f) => `entities.${i}.banks.${k}.${f}`));
  };
  const err = (path: string) => errors[path];

  async function submit() {
    setBusy(true);
    try {
      const r = await addClientAction({ name, industry, entities });
      if (!r.ok) {
        if (r.fields) {
          setErrors(r.fields);
          // Focus the first marked field so the message is where the user is looking.
          requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid=true]")?.focus());
        } else toast.error(r.error);
        return;
      }
      toast.success(`${name} ditambahkan`);
      router.push(`/clients/${r.clientId}/opening`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Klien</CardTitle>
          <CardDescription>Satu klien bisa berisi beberapa entitas, misalnya PT dan pemiliknya, yang dilaporkan sebagai gabungan.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="client-name">Nama klien</FieldLabel>
            <Input
              id="client-name"
              value={name}
              aria-invalid={!!err("name")}
              onChange={(e) => {
                setName(e.target.value);
                clearError("name");
                if (!firstNameTouched && entities[0]?.kind !== "PERORANGAN") setEntity(0, { name: e.target.value });
              }}
              placeholder="mis. Grup Maju Bersama"
            />
            <FieldError>{err("name")}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="client-industry">Bidang usaha</FieldLabel>
            <Input id="client-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="mis. distributor bahan bangunan" />
            <FieldDescription>Dipakai AI sebagai konteks saat mengusulkan akun.</FieldDescription>
          </Field>
        </CardContent>
      </Card>

      {entities.map((e, i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle>Entitas {i + 1}</CardTitle>
              <CardDescription>Badan usaha atau orang yang punya rekening sendiri.</CardDescription>
            </div>
            {entities.length > 1 && (
              <Button variant="ghost" size="sm" onClick={() => { setErrors({}); setEntities((es) => es.filter((_, j) => j !== i)); }}>
                <Trash2 /> Hapus entitas
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <Field>
                <FieldLabel>Jenis</FieldLabel>
                <Select value={e.kind} onValueChange={(v) => setEntity(i, { kind: v as Kind })}>
                  <SelectTrigger className="w-full" aria-label="Jenis entitas"><SelectValue>{KIND_LABEL[e.kind]}</SelectValue></SelectTrigger>
                  <SelectContent>{(Object.keys(KIND_LABEL) as Kind[]).map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor={`e-name-${i}`}>Nama lengkap</FieldLabel>
                <Input
                  id={`e-name-${i}`}
                  value={e.name}
                  aria-invalid={!!err(`entities.${i}.name`)}
                  onChange={(ev) => {
                    if (i === 0) setFirstNameTouched(true);
                    setEntity(i, { name: ev.target.value });
                  }}
                  placeholder={e.kind === "PERORANGAN" ? "mis. Budi Santoso" : "mis. PT Maju Bersama Sejahtera"}
                />
                <FieldError>{err(`entities.${i}.name`)}</FieldError>
              </Field>
              <Field>
                <FieldLabel htmlFor={`e-short-${i}`}>Nama singkat</FieldLabel>
                <Input id={`e-short-${i}`} value={e.shortName} onChange={(ev) => setEntity(i, { shortName: ev.target.value })} placeholder={e.kind === "PERORANGAN" ? "mis. Budi" : "mis. PT Maju"} />
                <FieldDescription>Opsional. Dipakai di tabel dan laporan.</FieldDescription>
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor={`e-npwp-${i}`}>NPWP (opsional)</FieldLabel>
                <Input id={`e-npwp-${i}`} value={e.npwp} aria-invalid={!!err(`entities.${i}.npwp`)} onChange={(ev) => setEntity(i, { npwp: ev.target.value })} placeholder="01.234.567.8-015.000" />
                <FieldError>{err(`entities.${i}.npwp`)}</FieldError>
              </Field>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Rekening bank</div>
              {e.banks.map((b, k) => (
                <div key={k} className="grid gap-2 sm:grid-cols-[10rem_1fr_1fr_auto] sm:items-start">
                  <Select value={b.bank} onValueChange={(v) => setBank(i, k, { bank: v as Bank })}>
                    <SelectTrigger className="w-full" aria-label="Bank"><SelectValue>{BANK_LABEL[b.bank]}</SelectValue></SelectTrigger>
                    <SelectContent>{(Object.keys(BANK_LABEL) as Bank[]).map((x) => <SelectItem key={x} value={x}>{BANK_LABEL[x]}</SelectItem>)}</SelectContent>
                  </Select>
                  <div className="space-y-1">
                    <Input
                      aria-label="Nomor rekening"
                      inputMode="numeric"
                      value={b.number}
                      aria-invalid={!!err(`entities.${i}.banks.${k}.number`)}
                      onChange={(ev) => setBank(i, k, { number: ev.target.value })}
                      placeholder="Nomor rekening, sesuai rekening koran"
                    />
                    <FieldError>{err(`entities.${i}.banks.${k}.number`)}</FieldError>
                  </div>
                  <Input aria-label="Nama rekening" value={b.label} onChange={(ev) => setBank(i, k, { label: ev.target.value })} placeholder={`Nama (opsional), mis. ${BANK_LABEL[b.bank]} Giro`} />
                  <Button variant="ghost" size="icon" aria-label="Hapus rekening" disabled={e.banks.length === 1} onClick={() => { setErrors({}); setEntity(i, { banks: e.banks.filter((_, j) => j !== k) }); }}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <FieldError>{err(`entities.${i}.banks`)}</FieldError>
              <Button variant="outline" size="sm" onClick={() => setEntity(i, { banks: [...e.banks, newBank()] })}>
                <Plus /> Tambah rekening
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      <FieldError>{err("entities")}</FieldError>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={submit} disabled={busy}>
          {busy ? "Menyimpan…" : "Simpan klien"}
        </Button>
        <Button variant="outline" onClick={() => { setErrors({}); setEntities((es) => [...es, newEntity(es.some((x) => x.kind === "PERORANGAN") ? "PT" : "PERORANGAN")]); }}>
          <Plus /> Tambah entitas
        </Button>
        {Object.keys(errors).length > 1 && <span className="text-sm text-destructive">Periksa {Object.keys(errors).length} isian yang ditandai.</span>}
      </div>
    </div>
  );
}
