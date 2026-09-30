"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addBankAccountAction, addEntityAction, removeBankAccountAction, removeEntityAction, renameEntityAction, updateBankAccountAction } from "@/app/actions";
import { CURRENCIES, CURRENCY_CODES } from "@/lib/fx/currency";

type Bank = "BCA" | "MANDIRI" | "BRI" | "SMBC" | "GENERIC";
type Kind = "PT" | "CV" | "BADAN_USAHA_ASING" | "PERORANGAN";
const BANK_LABEL: Record<Bank, string> = { BCA: "BCA", MANDIRI: "Mandiri", BRI: "BRI", SMBC: "SMBC / Jenius", GENERIC: "Bank lain" };
const KIND_LABEL: Record<Kind, string> = { PT: "PT", CV: "CV", BADAN_USAHA_ASING: "Badan usaha asing", PERORANGAN: "Perorangan (pemilik)" };

/** `blocked` is the reason removal is refused (computed on the server from what points at it), null when it can go. */
export type BankView = { id: string; label: string; bank: Bank; number: string; code: string; isOverdraft: boolean; blocked: string | null; identityLocked: boolean };
export type EntityView = { id: string; name: string; shortName: string; npwp: string; kind: Kind; blocked: string | null; banks: BankView[] };

/** Fields of one bank account (bank, number, name, PRK). `prefix` is the error-key path the server reports under. */
function BankFields({ value, onChange, errors, prefix, lockIdentity = false, showPrk = true }: { value: { bank: Bank; number: string; label: string; isOverdraft: boolean }; onChange: (v: { bank: Bank; number: string; label: string; isOverdraft: boolean }) => void; errors: Record<string, string>; prefix: string; lockIdentity?: boolean; showPrk?: boolean }) {
  const id = prefix.replace(/\W/g, "-");
  return (
    <div className="grid gap-2 sm:grid-cols-[10rem_1fr_1fr]">
      <Select value={value.bank} onValueChange={(v) => onChange({ ...value, bank: v as Bank })} disabled={lockIdentity}>
        <SelectTrigger className="w-full" aria-label="Bank"><SelectValue>{BANK_LABEL[value.bank]}</SelectValue></SelectTrigger>
        <SelectContent>{(Object.keys(BANK_LABEL) as Bank[]).map((b) => <SelectItem key={b} value={b}>{BANK_LABEL[b]}</SelectItem>)}</SelectContent>
      </Select>
      <div className="space-y-1">
        <Input aria-label="Nomor rekening" inputMode="numeric" disabled={lockIdentity} value={value.number} aria-invalid={!!errors[`${prefix}.number`]} onChange={(e) => onChange({ ...value, number: e.target.value })} placeholder="Nomor rekening, sesuai rekening koran" />
        <FieldError>{errors[`${prefix}.number`]}</FieldError>
      </div>
      <div className="space-y-1.5">
        <Input aria-label="Nama rekening" value={value.label} onChange={(e) => onChange({ ...value, label: e.target.value })} placeholder={`Nama (opsional), mis. ${BANK_LABEL[value.bank]} Giro`} />
        {showPrk && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox id={`prk-${id}`} checked={value.isOverdraft} onCheckedChange={(v) => onChange({ ...value, isOverdraft: v === true })} />
            <label htmlFor={`prk-${id}`}>Pinjaman rekening koran (PRK), saldonya utang ke bank</label>
          </div>
        )}
      </div>
    </div>
  );
}

const emptyBank = () => ({ bank: "BCA" as Bank, number: "", label: "", isOverdraft: false });

/** Add a bank account to a company/owner that already exists, inline under it. */
function AddBank({ clientId, entity, onDone }: { clientId: string; entity: EntityView; onDone: () => void }) {
  const router = useRouter();
  const [bank, setBank] = useState(emptyBank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const r = await addBankAccountAction(clientId, entity.id, bank);
      if (!r.ok) {
        setErrors(r.fields ?? {});
        return void toast.error(r.error);
      }
      toast.success(`Rekening ditambahkan ke ${entity.name}`);
      onDone();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 border-t pt-3" data-testid={`add-bank-${entity.id}`}>
      <BankFields value={bank} onChange={(v) => { setBank(v); setErrors({}); }} errors={errors} prefix="bank" />
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={busy}>{busy ? "Menyimpan…" : "Simpan rekening"}</Button>
        <Button size="sm" variant="ghost" onClick={onDone} disabled={busy}>Batal</Button>
      </div>
    </div>
  );
}

/** Add a company or owner to the client, with an optional first bank account. */
function AddEntity({ clientId, onDone }: { clientId: string; onDone: () => void }) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("PERORANGAN");
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [currency, setCurrency] = useState("IDR");
  const [npwp, setNpwp] = useState("");
  const [bank, setBank] = useState(emptyBank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const r = await addEntityAction(clientId, { name, shortName, kind, npwp, currency, banks: [bank] });
      if (!r.ok) {
        setErrors(r.fields ?? {});
        return void toast.error(r.error);
      }
      toast.success(`${name.trim()} ditambahkan`);
      onDone();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  const clear = () => setErrors({});
  return (
    <div className="space-y-4 border-t pt-4" data-testid="add-entity">
      <div className="grid gap-4 sm:grid-cols-4">
        <Field>
          <FieldLabel>Jenis</FieldLabel>
          <Select value={kind} onValueChange={(v) => { setKind(v as Kind); clear(); }}>
            <SelectTrigger className="w-full" aria-label="Jenis perusahaan atau pemilik"><SelectValue>{KIND_LABEL[kind]}</SelectValue></SelectTrigger>
            <SelectContent>{(Object.keys(KIND_LABEL) as Kind[]).map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="new-entity-name">Nama lengkap</FieldLabel>
          <Input id="new-entity-name" value={name} aria-invalid={!!errors["entity.name"]} onChange={(e) => { setName(e.target.value); clear(); }} placeholder={kind === "PERORANGAN" ? "mis. Budi Santoso" : "mis. PT Maju Bersama Sejahtera"} />
          <FieldError>{errors["entity.name"]}</FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor="new-entity-short">Nama singkat</FieldLabel>
          <Input id="new-entity-short" value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="Opsional" />
        </Field>
        <Field>
          <FieldLabel>Mata uang pembukuan</FieldLabel>
          <Select value={currency} onValueChange={(v) => setCurrency(v as string)}>
            <SelectTrigger className="w-full" aria-label="Mata uang pembukuan"><SelectValue>{currency}</SelectValue></SelectTrigger>
            <SelectContent>{CURRENCY_CODES.map((c) => <SelectItem key={c} value={c}>{c} · {CURRENCIES[c].name}</SelectItem>)}</SelectContent>
          </Select>
          <FieldError>{errors["entity.currency"]}</FieldError>
        </Field>
        {kind !== "BADAN_USAHA_ASING" && (
          <Field>
            <FieldLabel htmlFor="new-entity-npwp">NPWP (opsional)</FieldLabel>
            <Input id="new-entity-npwp" value={npwp} aria-invalid={!!errors["entity.npwp"]} onChange={(e) => { setNpwp(e.target.value); clear(); }} placeholder="01.234.567.8-015.000" />
            <FieldError>{errors["entity.npwp"]}</FieldError>
          </Field>
        )}
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium">Rekening bank pertama (opsional)</div>
        <BankFields value={bank} onChange={(v) => { setBank(v); clear(); }} errors={errors} prefix="entity.banks.0" />
      </div>
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
        <Button variant="ghost" onClick={onDone} disabled={busy}>Batal</Button>
      </div>
    </div>
  );
}

/** Rename a company/owner: labels only, no figure moves. */
function EditEntity({ clientId, entity, onDone }: { clientId: string; entity: EntityView; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(entity.name);
  const [shortName, setShortName] = useState(entity.shortName);
  const [npwp, setNpwp] = useState(entity.npwp);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const r = await renameEntityAction(clientId, entity.id, { name, shortName, npwp });
      if (!r.ok) {
        setErrors(r.fields ?? {});
        return void toast.error(r.error);
      }
      toast.success("Perubahan disimpan");
      onDone();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  const clear = () => setErrors({});
  return (
    <div className="space-y-3 border-t pt-3" data-testid={`edit-entity-${entity.id}`}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field>
          <FieldLabel htmlFor={`edit-name-${entity.id}`}>Nama lengkap</FieldLabel>
          <Input id={`edit-name-${entity.id}`} value={name} aria-invalid={!!errors.name} onChange={(e) => { setName(e.target.value); clear(); }} />
          <FieldError>{errors.name}</FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor={`edit-short-${entity.id}`}>Nama singkat</FieldLabel>
          <Input id={`edit-short-${entity.id}`} value={shortName} aria-invalid={!!errors.shortName} onChange={(e) => { setShortName(e.target.value); clear(); }} />
          <FieldError>{errors.shortName}</FieldError>
        </Field>
        {entity.kind !== "BADAN_USAHA_ASING" && (
          <Field>
            <FieldLabel htmlFor={`edit-npwp-${entity.id}`}>NPWP (opsional)</FieldLabel>
            <Input id={`edit-npwp-${entity.id}`} value={npwp} aria-invalid={!!errors.npwp} onChange={(e) => { setNpwp(e.target.value); clear(); }} />
            <FieldError>{errors.npwp}</FieldError>
          </Field>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Hanya nama yang berubah. Jurnal, saldo dan laporan yang sudah ada tidak bergeser.</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={busy}>{busy ? "Menyimpan…" : "Simpan perubahan"}</Button>
        <Button size="sm" variant="ghost" onClick={onDone} disabled={busy}>Batal</Button>
      </div>
    </div>
  );
}

/** Rename a bank account; bank and number stay put once statements were imported (files are matched against the number). */
function EditBank({ clientId, bank, onDone }: { clientId: string; bank: BankView; onDone: () => void }) {
  const router = useRouter();
  const [value, setValue] = useState({ bank: bank.bank, number: bank.number, label: bank.label, isOverdraft: bank.isOverdraft });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const r = await updateBankAccountAction(clientId, bank.id, { label: value.label, bank: value.bank, number: value.number });
      if (!r.ok) {
        setErrors(r.fields ?? {});
        return void toast.error(r.error);
      }
      toast.success("Perubahan disimpan");
      onDone();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 border-t px-3 py-3" data-testid={`edit-bank-${bank.id}`}>
      <BankFields value={value} onChange={(v) => { setValue(v); setErrors({}); }} errors={errors} prefix="bank" lockIdentity={bank.identityLocked} showPrk={false} />
      {bank.identityLocked && <p className="text-xs text-muted-foreground">Bank dan nomor terkunci karena mutasi rekening ini sudah diimpor (file berikutnya dicocokkan dengan nomornya). Nama tetap bisa diubah.</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={busy}>{busy ? "Menyimpan…" : "Simpan perubahan"}</Button>
        <Button size="sm" variant="ghost" onClick={onDone} disabled={busy}>Batal</Button>
      </div>
    </div>
  );
}

/** *Hapus*: disabled with the reason written next to it when books point at it; otherwise a second click confirms. Admin only. */
function RemoveControl({ what, blocked, confirmText, onConfirm }: { what: string; blocked: string | null; confirmText: string; onConfirm: () => Promise<{ ok: boolean; error?: string }> }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try {
      const r = await onConfirm();
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${what} dihapus`);
      router.refresh();
    } finally {
      setBusy(false);
      setAsking(false);
    }
  }
  if (blocked) {
    return (
      <div className="space-y-1" data-testid="remove-blocked">
        <Button size="sm" variant="outline" disabled><Trash2 /> Hapus</Button>
        <p className="max-w-md text-xs text-muted-foreground">{blocked}</p>
      </div>
    );
  }
  if (!asking) return <Button size="sm" variant="outline" onClick={() => setAsking(true)}><Trash2 /> Hapus</Button>;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="remove-confirm">
      <span className="text-sm">{confirmText}</span>
      <Button size="sm" variant="destructive" onClick={confirm} disabled={busy}>{busy ? "Menghapus…" : "Ya, hapus"}</Button>
      <Button size="sm" variant="ghost" onClick={() => setAsking(false)} disabled={busy}>Batal</Button>
    </div>
  );
}

/** The client's companies/owners and their bank accounts: add, rename and (when nothing points at them) remove. `canRemove` = admin. */
export function EntitiesCard({ clientId, entities, canRemove }: { clientId: string; entities: EntityView[]; canRemove: boolean }) {
  // One inline form at a time: "add-entity", "add-bank:<entity>", "edit-entity:<id>" or "edit-bank:<id>".
  const [open, setOpen] = useState<string | null>(null);
  const close = () => setOpen(null);
  return (
    <Card data-testid="entities-card">
      <CardHeader>
        <CardTitle>Perusahaan & rekening</CardTitle>
        <CardDescription>Tambahkan, ubah nama atau hapus perusahaan, pemilik dan rekening bank. Yang sudah punya pembukuan tidak bisa dihapus dan angkanya tidak pernah berubah karena ganti nama. Rekening yang ditambahkan setelah Saldo Awal dicatat: saldo awalnya diisi lewat Jurnal Penyesuaian.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {entities.map((e) => (
          <div key={e.id} className="space-y-2" data-testid={`entity-${e.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium">{e.name}</div>
                <div className="text-xs text-muted-foreground">{KIND_LABEL[e.kind]}{e.shortName !== e.name ? ` · ${e.shortName}` : ""}</div>
              </div>
              <div className="flex flex-wrap items-start gap-2">
                {open !== `edit-entity:${e.id}` && <Button size="sm" variant="outline" aria-label={`Ubah ${e.name}`} onClick={() => setOpen(`edit-entity:${e.id}`)}><Pencil /> Ubah</Button>}
                {open !== `add-bank:${e.id}` && <Button size="sm" variant="outline" onClick={() => setOpen(`add-bank:${e.id}`)}><Plus /> Tambah rekening</Button>}
                {canRemove && (
                  <RemoveControl what={e.name} blocked={e.blocked} confirmText={`Hapus ${e.name} dan rekeningnya? Tidak bisa dibatalkan.`} onConfirm={() => removeEntityAction(clientId, e.id)} />
                )}
              </div>
            </div>
            {open === `edit-entity:${e.id}` && <EditEntity clientId={clientId} entity={e} onDone={close} />}
            {e.banks.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada rekening bank. Buku diisi dari file buku besar atau neraca.</p>
            ) : (
              <ul className="divide-y border text-sm">
                {e.banks.map((b) => (
                  <li key={b.id} data-testid={`bank-${b.id}`}>
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate">{b.label}{b.isOverdraft ? " · PRK" : ""}</div>
                        <div className="num text-xs text-muted-foreground">{b.number} · {b.code}</div>
                      </div>
                      <div className="flex flex-wrap items-start gap-2">
                        {open !== `edit-bank:${b.id}` && <Button size="sm" variant="ghost" aria-label={`Ubah ${b.label}`} onClick={() => setOpen(`edit-bank:${b.id}`)}><Pencil /> Ubah</Button>}
                        {canRemove && (
                          <RemoveControl what={b.label} blocked={b.blocked} confirmText={`Hapus ${b.label}? Tidak bisa dibatalkan.`} onConfirm={() => removeBankAccountAction(clientId, b.id)} />
                        )}
                      </div>
                    </div>
                    {open === `edit-bank:${b.id}` && <EditBank clientId={clientId} bank={b} onDone={close} />}
                  </li>
                ))}
              </ul>
            )}
            {open === `add-bank:${e.id}` && <AddBank clientId={clientId} entity={e} onDone={close} />}
          </div>
        ))}
        {open === "add-entity" ? (
          <AddEntity clientId={clientId} onDone={close} />
        ) : (
          <Button variant="outline" onClick={() => setOpen("add-entity")}><Plus /> Tambah perusahaan atau pemilik</Button>
        )}
      </CardContent>
    </Card>
  );
}
