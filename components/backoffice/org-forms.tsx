"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/app/simple-select";
import { createOrganisationAction, extendGrantAction, grantAccessAction, inviteMemberAction, revokeGrantAction, setLimitsAction, setSuspendedAction } from "@/app/backoffice-actions";

type Result = { ok: true } | { ok: false; error: string };
const GRANT_KINDS = [{ value: "TRIAL", label: "Uji coba" }, { value: "PAID", label: "Berbayar" }, { value: "COMP", label: "Gratis" }];

/** The date `days` from today in Jakarta, as YYYY-MM-DD (the end date of a trial of that length). */
export function wibDatePlus(days: number) {
  return new Date(Date.now() + 7 * 3600_000 + days * 86_400_000).toISOString().slice(0, 10);
}

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run(work: () => Promise<Result>, done: string, after?: () => void) {
    setBusy(true);
    const r = await work();
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(done);
    after?.();
    router.refresh();
  }
  return { busy, run };
}

function Labeled({ id, label, children, className }: { id: string; label: string; children: React.ReactNode; className?: string }) {
  return <div className={className ?? "space-y-1"}><label htmlFor={id} className="text-sm">{label}</label>{children}</div>;
}

/** End date with 14 days / 30 days / no end shortcuts; empty = no end. */
function EndDate({ id, value, onChange, allowOpen = true }: { id: string; value: string; onChange: (v: string) => void; allowOpen?: boolean }) {
  return (
    <div className="space-y-2">
      <Input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} />
      <div className="flex flex-wrap gap-1">
        <Button type="button" size="xs" variant="ghost" onClick={() => onChange(wibDatePlus(14))}>14 hari</Button>
        <Button type="button" size="xs" variant="ghost" onClick={() => onChange(wibDatePlus(30))}>30 hari</Button>
        {allowOpen && <Button type="button" size="xs" variant="ghost" onClick={() => onChange("")}>Tanpa batas</Button>}
      </div>
    </div>
  );
}

export function CreateOrganisationForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("KANTOR_AKUNTAN");
  const [grantKind, setGrantKind] = useState("TRIAL");
  const [endsOn, setEndsOn] = useState(wibDatePlus(14));
  const [seats, setSeats] = useState("5");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4" data-testid="create-organisation">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Labeled id="org-name" label="Nama organisasi"><Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></Labeled>
        <Labeled id="org-kind" label="Jenis"><SimpleSelect id="org-kind" label="Jenis" value={kind} onChange={setKind} options={[{ value: "KANTOR_AKUNTAN", label: "Kantor akuntan" }, { value: "PERUSAHAAN", label: "Perusahaan" }]} /></Labeled>
        <Labeled id="org-grant" label="Akses"><SimpleSelect id="org-grant" label="Akses" value={grantKind} onChange={setGrantKind} options={GRANT_KINDS} /></Labeled>
        <Labeled id="org-seats" label="Batas anggota"><Input id="org-seats" type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} placeholder="Tanpa batas" /></Labeled>
      </div>
      <Labeled id="org-ends" label="Berakhir" className="max-w-xs space-y-1"><EndDate id="org-ends" value={endsOn} onChange={setEndsOn} /></Labeled>
      <Button disabled={busy || !name.trim()} onClick={async () => {
        setBusy(true);
        const r = await createOrganisationAction({ name, kind, grant: { kind: grantKind, endsOn: endsOn || null }, seatLimit: seats ? Number(seats) : null });
        setBusy(false);
        if (!r.ok) return void toast.error(r.error);
        toast.success(`${name.trim()} dibuat`);
        router.push(`/backoffice/orgs/${r.firmId}`);
      }}>{busy && <Loader2 className="animate-spin" />}Buat organisasi</Button>
    </div>
  );
}

export function GrantForm({ firmId }: { firmId: string }) {
  const { busy, run } = useRun();
  const [kind, setKind] = useState("PAID");
  const [endsOn, setEndsOn] = useState(wibDatePlus(30));
  const [note, setNote] = useState("");
  return (
    <div className="space-y-3" data-testid="grant-form">
      <div className="grid gap-3 sm:grid-cols-3">
        <Labeled id="grant-kind" label="Jenis"><SimpleSelect id="grant-kind" label="Jenis" value={kind} onChange={setKind} options={GRANT_KINDS} /></Labeled>
        <Labeled id="grant-ends" label="Berakhir"><EndDate id="grant-ends" value={endsOn} onChange={setEndsOn} /></Labeled>
        <Labeled id="grant-note" label="Catatan"><Input id="grant-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opsional" /></Labeled>
      </div>
      <Button disabled={busy} onClick={() => run(() => grantAccessAction(firmId, { kind, endsOn: endsOn || null, note }), "Akses diberikan", () => setNote(""))}>Beri akses</Button>
    </div>
  );
}

export function GrantRowActions({ firmId, grantId, endsOn }: { firmId: string; grantId: string; endsOn: string }) {
  const { busy, run } = useRun();
  const [mode, setMode] = useState<null | "extend" | "revoke">(null);
  const [date, setDate] = useState(endsOn || wibDatePlus(30));
  const [reason, setReason] = useState("");
  if (mode === "extend") return (
    <div className="flex flex-wrap items-end gap-2">
      <Input aria-label="Berakhir baru" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
      <Button size="sm" disabled={busy} onClick={() => run(() => extendGrantAction(firmId, grantId, date || null), "Akses diubah", () => setMode(null))}>Simpan</Button>
      <Button size="sm" variant="ghost" onClick={() => setMode(null)}>Batal</Button>
    </div>
  );
  if (mode === "revoke") return (
    <div className="flex flex-wrap items-end gap-2">
      <Input aria-label="Alasan mencabut" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Alasan" className="w-48" />
      <Button size="sm" variant="destructive" disabled={busy || reason.trim().length < 5} onClick={() => run(() => revokeGrantAction(firmId, grantId, reason), "Akses dicabut", () => setMode(null))}>Cabut</Button>
      <Button size="sm" variant="ghost" onClick={() => setMode(null)}>Batal</Button>
    </div>
  );
  return (
    <div className="flex flex-wrap gap-1">
      <Button size="sm" variant="outline" onClick={() => setMode("extend")}>Ubah tanggal</Button>
      <Button size="sm" variant="ghost" onClick={() => setMode("revoke")}>Cabut</Button>
    </div>
  );
}

export function LimitsForm({ firmId, seatLimit, aiBudget, defaultBudget }: { firmId: string; seatLimit: number | null; aiBudget: number | null; defaultBudget: number }) {
  const { busy, run } = useRun();
  const [seats, setSeats] = useState(seatLimit?.toString() ?? "");
  const [budget, setBudget] = useState(aiBudget?.toString() ?? "");
  return (
    <div className="space-y-3" data-testid="limits-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <Labeled id="limit-seats" label="Batas anggota aktif"><Input id="limit-seats" type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} placeholder="Tanpa batas" /></Labeled>
        <Labeled id="limit-ai" label="Token AI per bulan"><Input id="limit-ai" type="number" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder={`Bawaan ${defaultBudget.toLocaleString("id-ID")}`} /></Labeled>
      </div>
      <Button variant="outline" disabled={busy} onClick={() => run(() => setLimitsAction(firmId, { seatLimit: seats ? Number(seats) : null, aiMonthlyTokenBudget: budget ? Number(budget) : null }), "Batas disimpan")}>Simpan batas</Button>
    </div>
  );
}

export function SuspendForm({ firmId, suspended }: { firmId: string; suspended: boolean }) {
  const { busy, run } = useRun();
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="suspend-form">
      <Labeled id="suspend-reason" label={suspended ? "Catatan (opsional)" : "Alasan"} className="min-w-64 flex-1 space-y-1"><Input id="suspend-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Labeled>
      {suspended
        ? <Button variant="outline" disabled={busy} onClick={() => run(() => setSuspendedAction(firmId, false, reason), "Organisasi dipulihkan", () => setReason(""))}>Pulihkan</Button>
        : <Button variant="destructive" disabled={busy || reason.trim().length < 5} onClick={() => run(() => setSuspendedAction(firmId, true, reason), "Organisasi ditangguhkan", () => setReason(""))}>Tangguhkan</Button>}
    </div>
  );
}

export function InviteOwnerForm({ firmId }: { firmId: string }) {
  const { busy, run } = useRun();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("OWNER");
  return (
    <div className="space-y-3" data-testid="invite-owner">
      <div className="grid gap-3 sm:grid-cols-3">
        <Labeled id="owner-name" label="Nama"><Input id="owner-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></Labeled>
        <Labeled id="owner-email" label="Email"><Input id="owner-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></Labeled>
        <Labeled id="owner-role" label="Peran"><SimpleSelect id="owner-role" label="Peran" value={role} onChange={setRole} options={[{ value: "OWNER", label: "Pemilik" }, { value: "ADMIN", label: "Admin" }]} /></Labeled>
      </div>
      <Button variant="outline" disabled={busy || !email.trim() || !name.trim()} onClick={() => run(() => inviteMemberAction(firmId, { email, name, role }), `Undangan terkirim ke ${email.trim()}`, () => { setEmail(""); setName(""); })}>Kirim undangan</Button>
    </div>
  );
}
