"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
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

  const setEntity = (i: number, patch: Partial<EntityRow>) => setEntities((es) => es.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const setBank = (i: number, k: number, patch: Partial<BankRow>) =>
    setEntity(i, { banks: entities[i].banks.map((b, j) => (j === k ? { ...b, ...patch } : b)) });

  async function submit() {
    setBusy(true);
    try {
      const r = await addClientAction({ name, industry, entities });
      if (!r.ok) {
        toast.error(r.error);
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
            <Input id="client-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Grup Maju Bersama" />
          </Field>
          <Field>
            <FieldLabel htmlFor="client-industry">Bidang usaha</FieldLabel>
            <Input id="client-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="distributor bahan bangunan" />
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
              <Button variant="ghost" size="sm" onClick={() => setEntities((es) => es.filter((_, j) => j !== i))}>
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
                <Input id={`e-name-${i}`} value={e.name} onChange={(ev) => setEntity(i, { name: ev.target.value })} placeholder={e.kind === "PERORANGAN" ? "Budi Santoso" : "PT Maju Bersama Sejahtera"} />
              </Field>
              <Field>
                <FieldLabel htmlFor={`e-short-${i}`}>Nama singkat</FieldLabel>
                <Input id={`e-short-${i}`} value={e.shortName} onChange={(ev) => setEntity(i, { shortName: ev.target.value })} placeholder={e.kind === "PERORANGAN" ? "Budi" : "PT Maju"} />
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor={`e-npwp-${i}`}>NPWP (opsional)</FieldLabel>
                <Input id={`e-npwp-${i}`} value={e.npwp} onChange={(ev) => setEntity(i, { npwp: ev.target.value })} placeholder="01.234.567.8-015.000" />
              </Field>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Rekening bank</div>
              {e.banks.map((b, k) => (
                <div key={k} className="grid gap-2 sm:grid-cols-[10rem_1fr_1fr_auto]">
                  <Select value={b.bank} onValueChange={(v) => setBank(i, k, { bank: v as Bank })}>
                    <SelectTrigger className="w-full" aria-label="Bank"><SelectValue>{BANK_LABEL[b.bank]}</SelectValue></SelectTrigger>
                    <SelectContent>{(Object.keys(BANK_LABEL) as Bank[]).map((x) => <SelectItem key={x} value={x}>{BANK_LABEL[x]}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input aria-label="Nomor rekening" inputMode="numeric" value={b.number} onChange={(ev) => setBank(i, k, { number: ev.target.value })} placeholder="Nomor rekening" />
                  <Input aria-label="Nama rekening" value={b.label} onChange={(ev) => setBank(i, k, { label: ev.target.value })} placeholder="Nama rekening, mis. BCA Giro" />
                  <Button variant="ghost" size="icon" aria-label="Hapus rekening" disabled={e.banks.length === 1} onClick={() => setEntity(i, { banks: e.banks.filter((_, j) => j !== k) })}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setEntity(i, { banks: [...e.banks, newBank()] })}>
                <Plus /> Tambah rekening
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={submit} disabled={busy || !name.trim()}>
          {busy ? "Menyimpan…" : "Simpan klien"}
        </Button>
        <Button variant="outline" onClick={() => setEntities((es) => [...es, newEntity(es.some((x) => x.kind === "PERORANGAN") ? "PT" : "PERORANGAN")])}>
          <Plus /> Tambah entitas
        </Button>
      </div>
    </div>
  );
}
