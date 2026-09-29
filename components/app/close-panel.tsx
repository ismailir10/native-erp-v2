"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Lock, LockOpen, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusPill } from "@/components/app/status";
import { ackControlAction, explainControlAction, lockAction, signoffAction, unlockAction } from "@/app/actions";
import type { Control } from "@/lib/controls";
import type { ControlExplanation } from "@/lib/controls/explain";

const ORDER = { FAIL: 0, REVIEW: 1, PASS: 2 } as const;

export function ClosePanel(props: {
  clientId: string;
  year: number;
  month: number;
  periodLabel: string;
  controls: Control[];
  signoffs: { key: string; label: string; done: boolean; by: string | null }[];
  locked: boolean;
  lockedAt: string | null;
  blockers: string[];
  /** AI configured: each flagged row offers "Jelaskan" (accounting-rules 20b). */
  aiReady?: boolean;
}) {
  const { clientId, year, month } = props;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ackFor, setAckFor] = useState<Control | null>(null);
  const [note, setNote] = useState("");
  const [explained, setExplained] = useState<Record<string, ControlExplanation>>({});
  const [explaining, setExplaining] = useState<string | null>(null);
  // Locking and reopening change what every import and journal may do: both are confirmed first.
  const [confirm, setConfirm] = useState<"lock" | "unlock" | null>(null);
  const explain = async (c: Control) => {
    setExplaining(c.key);
    const r = await explainControlAction(clientId, year, month, c.key);
    setExplaining(null);
    if (!r.ok) return void toast.error(r.error);
    setExplained((x) => ({ ...x, [c.key]: r.explanation }));
    if (r.explanation.proposal) router.refresh();
  };
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error((r as { error: string }).error);
      else {
        if (success) toast.success(success);
        router.refresh();
      }
    });

  const groups = [...new Set(props.controls.map((c) => c.scope))];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {groups.map((g) => (
          <Card key={g}>
            <CardHeader>
              <CardTitle>{g}</CardTitle>
            </CardHeader>
            <CardContent className="divide-y px-0">
              {props.controls
                .filter((c) => c.scope === g)
                .sort((a, b) => ORDER[a.status] - ORDER[b.status])
                .map((c) => (
                <div key={c.key} className="flex flex-wrap items-center gap-3 px-6 py-2.5" data-testid={`control-${c.key.split(":")[0]}`}>
                  <StatusPill status={c.status} />
                  <div className="min-w-0 flex-1 basis-56">
                    <div className="text-sm font-medium">{c.title}</div>
                    <div className="text-xs text-muted-foreground">{c.detail}</div>
                    {c.ack && <div className="mt-1 flex items-center gap-1 text-xs text-foreground"><MessageSquare className="size-3" /> {c.ack}</div>}
                  </div>
                  {c.href && c.status !== "PASS" && (
                    <Link href={c.href} className="text-sm font-medium text-primary hover:underline">Periksa</Link>
                  )}
                  {c.status !== "PASS" && !props.locked && props.aiReady && !explained[c.key] && (
                    <Button variant="ghost" size="sm" disabled={explaining !== null} onClick={() => explain(c)}>
                      {explaining === c.key ? "Menjelaskan…" : "Jelaskan"}
                    </Button>
                  )}
                  {c.status === "REVIEW" && !props.locked && (
                    <Button variant="outline" size="sm" onClick={() => { setAckFor(c); setNote(c.ack ?? ""); }}>
                      {c.ack ? "Ubah catatan" : "Beri catatan"}
                    </Button>
                  )}
                  {explained[c.key] && (
                    <div className="basis-full space-y-1.5 border-l-2 border-primary/30 pl-3 text-sm" data-testid="control-explanation">
                      <p>{explained[c.key].explanation}</p>
                      {explained[c.key].suggestion && <p><span className="font-medium">Usulan AI:</span> {explained[c.key].suggestion}</p>}
                      {explained[c.key].links.length > 0 && (
                        <ul className="space-y-0.5 text-xs">
                          {explained[c.key].links.map((l) => (
                            <li key={l.id}><Link href={l.href} className="text-muted-foreground underline decoration-border underline-offset-4 hover:text-primary hover:decoration-primary">{l.label} ›</Link></li>
                          ))}
                        </ul>
                      )}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {explained[c.key].proposal && <span className="text-xs text-muted-foreground">Draf jurnal dibuat di <span className="font-medium text-foreground">Usulan jurnal koreksi</span>; dicatat setelah Anda klik.</span>}
                        {c.status === "REVIEW" && explained[c.key].note && (
                          <Button variant="outline" size="sm" onClick={() => { setAckFor(c); setNote(explained[c.key].note); }}>Pakai sebagai catatan</Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Daftar periksa</CardTitle>
            <CardDescription>Diperiksa dan dicentang oleh akuntan</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {props.signoffs.map((s) => (
              // Not wrapped in <label>: a wrapping label re-forwards the click and toggles twice.
              <div key={s.key} className="flex items-start gap-2 text-sm">
                <Checkbox
                  id={`signoff-${s.key}`}
                  checked={s.done}
                  disabled={pending || props.locked}
                  onCheckedChange={(v) => run(() => signoffAction(clientId, year, month, s.key, Boolean(v)))}
                  className="mt-0.5"
                />
                <label htmlFor={`signoff-${s.key}`} className="cursor-pointer">{s.label}{s.by && <span className="block text-xs text-muted-foreground">Dicentang {s.by}</span>}</label>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className={props.locked ? "border-pass/30" : ""}>
          <CardHeader>
            <CardTitle>{props.locked ? `Buku ${props.periodLabel} ditutup` : `Tutup buku ${props.periodLabel}`}</CardTitle>
            <CardDescription>
              {props.locked ? `Dikunci ${props.lockedAt}. Impor & jurnal ke periode ini ditolak.` : "Setelah ditutup, periode dikunci dari perubahan."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!props.locked && props.blockers.length > 0 && (
              <ul className="space-y-1 text-sm text-muted-foreground">
                {props.blockers.map((b) => <li key={b}>• {b}</li>)}
              </ul>
            )}
            {props.locked ? (
              <Button variant="outline" className="w-full" disabled={pending} onClick={() => setConfirm("unlock")}>
                <LockOpen /> Buka kembali periode
              </Button>
            ) : (
              <Button className="w-full" disabled={pending || props.blockers.length > 0} onClick={() => setConfirm("lock")} data-testid="lock">
                {pending ? <Loader2 className="animate-spin" /> : <Lock />} Tutup buku {props.periodLabel}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === "lock" ? `Tutup buku ${props.periodLabel}?` : `Buka kembali ${props.periodLabel}?`}</DialogTitle>
            <DialogDescription>
              {confirm === "lock"
                ? `Setelah ditutup, impor mutasi, reklasifikasi dan jurnal ke ${props.periodLabel} ditolak sampai periodenya dibuka kembali. Catatan kontrol dan daftar periksa ikut tersimpan.`
                : `Periode ${props.periodLabel} bisa diubah lagi. Laporan yang sudah dikirim ke klien bisa berbeda setelah ada perubahan.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Batal</Button>
            <Button
              disabled={pending}
              data-testid="confirm-lock"
              onClick={() => {
                const which = confirm;
                setConfirm(null);
                if (which === "lock") run(() => lockAction(clientId, year, month), `Buku ${props.periodLabel} ditutup`);
                else run(() => unlockAction(clientId, year, month), "Periode dibuka kembali");
              }}
            >
              {confirm === "lock" ? `Tutup buku ${props.periodLabel}` : "Buka kembali"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(ackFor)} onOpenChange={(o) => !o && setAckFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Catatan: {ackFor?.title}</DialogTitle>
            <DialogDescription>{ackFor?.detail}. Jelaskan kenapa ini wajar. Catatan ikut tersimpan di arsip tutup buku.</DialogDescription>
          </DialogHeader>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. Transfer pinjaman pemilik, bukti di folder klien" rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAckFor(null)}>Batal</Button>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await ackControlAction(clientId, year, month, ackFor!.key, note);
                  if (!r.ok) return void toast.error(r.error);
                  setAckFor(null);
                  router.refresh();
                })
              }
            >
              Simpan catatan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
