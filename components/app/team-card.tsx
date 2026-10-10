"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SimpleSelect } from "@/components/app/simple-select";
import { assignClientsAction, inviteMemberAction, setDisabledAction, setRoleAction, transferOwnershipAction } from "@/app/team-actions";

type Role = "OWNER" | "ADMIN" | "AKUNTAN" | "VIEWER";
export type TeamMember = { id: string; name: string; email: string; role: Role; disabled: boolean; clientIds: string[] };
type Props = {
  members: TeamMember[];
  clients: { id: string; name: string }[];
  me: { id: string; role: Role };
  company: boolean;
  seatLimit: number | null;
};

const ROLE_LABEL: Record<Role, string> = { OWNER: "Pemilik", ADMIN: "Admin", AKUNTAN: "Akuntan", VIEWER: "Peninjau" };
const ROLE_HINT: Record<Role, string> = {
  OWNER: "Semua yang dilakukan admin, termasuk mengatur pemilik lain.",
  ADMIN: "Semua klien, pengaturan, membuka periode, menghapus impor, mengatur tim.",
  AKUNTAN: "Mengerjakan klien yang ditugaskan.",
  VIEWER: "Melihat dan mengunduh laporan klien yang ditugaskan.",
};
const assigned = (role: Role) => role === "AKUNTAN" || role === "VIEWER";

/** Pengaturan → Tim: who is in the organisation, what they may do, and which clients they work on (ADR 0017 §5). */
export function TeamCard({ members, clients, me, company, seatLimit }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const roles = (me.role === "OWNER" ? ["OWNER", "ADMIN", "AKUNTAN", "VIEWER"] : ["ADMIN", "AKUNTAN", "VIEWER"]) as Role[];
  const active = members.filter((m) => !m.disabled).length;
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  async function run(key: string, work: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    setBusy(key);
    const r = await work();
    setBusy(null);
    if (!r.ok) return void toast.error(r.error);
    toast.success(done);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <InviteCard roles={roles} clients={clients} company={company} full={seatLimit !== null && active >= seatLimit} />
      <Card data-testid="team-members">
        <CardHeader>
          <CardTitle>Anggota</CardTitle>
          <CardDescription>{seatLimit === null ? `${active} anggota aktif.` : `${active} dari ${seatLimit} anggota aktif.`} Anggota nonaktif tidak bisa masuk; datanya tetap tercatat.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {members.map((m) => {
            const self = m.id === me.id;
            const locked = self || (m.role === "OWNER" && me.role !== "OWNER");
            return (
              <div key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-4" data-testid="team-row">
                <div className="min-w-48 flex-1">
                  <p className="font-medium">{m.name}{self && <span className="text-muted-foreground"> · Anda</span>}{m.disabled && <span className="text-muted-foreground"> · nonaktif</span>}</p>
                  <p className="truncate text-sm text-muted-foreground">{m.email}</p>
                </div>
                <div className="w-40">
                  {locked ? <p className="text-sm">{ROLE_LABEL[m.role]}</p> : (
                    <SimpleSelect label={`Peran ${m.name}`} value={m.role} disabled={busy !== null} options={(roles.includes(m.role) ? roles : [m.role, ...roles]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                      onChange={(next) => next !== m.role && run(`role:${m.id}`, () => setRoleAction(m.id, next), `Peran ${m.name} diubah menjadi ${ROLE_LABEL[next as Role]}`)} />
                  )}
                </div>
                <div className="min-w-40 flex-1 text-sm">
                  {company || !assigned(m.role) ? <span className="text-muted-foreground">Semua klien</span> : (
                    <Button variant="outline" size="sm" data-testid="assign-clients" disabled={locked || busy !== null} onClick={() => setEditing(m)}>
                      {m.clientIds.length === 0 ? "Belum ada klien" : m.clientIds.length === 1 ? clientName.get(m.clientIds[0]) ?? "1 klien" : `${m.clientIds.length} klien`}
                    </Button>
                  )}
                </div>
                {!locked && (
                  <div className="flex flex-wrap gap-2">
                    {me.role === "OWNER" && m.role !== "OWNER" && !m.disabled && (
                      <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => run(`own:${m.id}`, () => transferOwnershipAction(m.id), `Kepemilikan diserahkan ke ${m.name}`)}>Serahkan kepemilikan</Button>
                    )}
                    <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => run(`off:${m.id}`, () => setDisabledAction(m.id, !m.disabled), m.disabled ? `${m.name} aktif kembali` : `${m.name} dinonaktifkan`)}>
                      {busy === `off:${m.id}` && <Loader2 className="animate-spin" />}{m.disabled ? "Aktifkan" : "Nonaktifkan"}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
      {editing && <ClientsDialog member={editing} clients={clients} onClose={() => setEditing(null)} onSave={(ids) => run(`clients:${editing.id}`, () => assignClientsAction(editing.id, ids), `Klien ${editing.name} disimpan`).then(() => setEditing(null))} />}
    </div>
  );
}

function ClientPicker({ clients, selected, onChange, idPrefix }: { clients: { id: string; name: string }[]; selected: string[]; onChange: (ids: string[]) => void; idPrefix: string }) {
  if (!clients.length) return <p className="text-sm text-muted-foreground">Belum ada klien.</p>;
  return (
    <div className="max-h-64 space-y-2 overflow-y-auto">
      {clients.map((c) => (
        <div key={c.id} className="flex items-center gap-2">
          <Checkbox id={`${idPrefix}-${c.id}`} checked={selected.includes(c.id)} onCheckedChange={(on) => onChange(on ? [...selected, c.id] : selected.filter((x) => x !== c.id))} />
          <label htmlFor={`${idPrefix}-${c.id}`} className="text-sm">{c.name}</label>
        </div>
      ))}
    </div>
  );
}

function ClientsDialog({ member, clients, onClose, onSave }: { member: TeamMember; clients: { id: string; name: string }[]; onClose: () => void; onSave: (ids: string[]) => void }) {
  const [selected, setSelected] = useState(member.clientIds);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Klien untuk {member.name}</DialogTitle>
          <DialogDescription>{ROLE_LABEL[member.role]} hanya melihat klien yang dicentang.</DialogDescription>
        </DialogHeader>
        <ClientPicker clients={clients} selected={selected} onChange={setSelected} idPrefix={`assign-${member.id}`} />
        <DialogFooter><Button onClick={() => onSave(selected)}>Simpan</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InviteCard({ roles, clients, company, full }: { roles: Role[]; clients: { id: string; name: string }[]; company: boolean; full: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("AKUNTAN");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <Card data-testid="team-invite">
      <CardHeader>
        <CardTitle>Undang anggota</CardTitle>
        <CardDescription>Undangan dikirim ke email; penerima mengatur kata sandinya sendiri.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1"><label htmlFor="invite-name" className="text-sm">Nama</label><Input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></div>
          <div className="space-y-1"><label htmlFor="invite-email" className="text-sm">Email</label><Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></div>
          <div className="space-y-1"><label htmlFor="invite-role" className="text-sm">Peran</label><SimpleSelect id="invite-role" label="Peran" value={role} onChange={(v) => setRole(v as Role)} options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} /></div>
        </div>
        <p className="text-sm text-muted-foreground">{ROLE_HINT[role]}</p>
        {!company && assigned(role) && (
          <div className="space-y-2"><p className="text-sm font-medium">Klien yang ditugaskan</p><ClientPicker clients={clients} selected={selected} onChange={setSelected} idPrefix="invite" /></div>
        )}
        {full && <p className="text-sm text-muted-foreground">Batas anggota aktif sudah tercapai. Nonaktifkan anggota lain atau hubungi Buku.</p>}
        <Button disabled={busy || full || !email.trim() || !name.trim()} onClick={async () => {
          setBusy(true);
          const r = await inviteMemberAction({ email, name, role, clientIds: company ? [] : selected });
          setBusy(false);
          if (!r.ok) return void toast.error(r.error);
          toast.success(`Undangan terkirim ke ${email.trim()}`);
          setEmail(""); setName(""); setSelected([]);
          router.refresh();
        }}>
          {busy ? <Loader2 className="animate-spin" /> : <UserPlus />} Kirim undangan
        </Button>
      </CardContent>
    </Card>
  );
}
