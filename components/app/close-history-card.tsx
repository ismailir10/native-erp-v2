"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusPill } from "@/components/app/status";
import { closeHistoryMonthAction, historyPreviewAction } from "@/app/actions";
import type { HistoryPreview } from "@/lib/controls/history";

const NOTE_MIN = 10;

/**
 * Tutup bulan-bulan sebelumnya (lib/controls/history): the open months before the selected one, checked together and closed in order
 * with one note and one confirmation of the sign-offs. The browser drives the run one month per call, so progress shows and a failure
 * stops it with every earlier month complete.
 */
export function CloseHistoryCard(props: {
  clientId: string;
  year: number;
  month: number;
  periodLabel: string;
  /** Open months with activity before the selected one: count and range. */
  count: number;
  range: string;
  signoffs: { key: string; label: string }[];
  isAdmin: boolean;
  /** `/clients/<id>` — links to a month's own Tutup Buku page. */
  base: string;
}) {
  const { clientId, year, month } = props;
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState<HistoryPreview | null>(null);
  const [note, setNote] = useState("");
  const [ticked, setTicked] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState<{ done: number; current: string } | null>(null);

  const check = async () => {
    setChecking(true);
    const r = await historyPreviewAction(clientId, year, month);
    setChecking(false);
    if (!r.ok) return void toast.error(r.error);
    setPreview(r.preview);
  };
  const closable = preview?.months.filter((m) => m.status !== "FAIL") ?? [];
  const stop = preview?.months.find((m) => m.status === "FAIL") ?? null;
  const ready = note.trim().length >= NOTE_MIN && props.signoffs.every((s) => ticked.includes(s.key));
  const span = closable.length ? (closable.length === 1 ? closable[0].label : `${closable[0].label} – ${closable.at(-1)!.label}`) : "";

  const run = async () => {
    setConfirm(false);
    for (const [i, m] of closable.entries()) {
      setProgress({ done: i, current: m.label });
      const r = await closeHistoryMonthAction(clientId, { year, month }, { year: m.year, month: m.month }, note, m.fingerprint, i === closable.length - 1);
      if (!r.ok) {
        setProgress(null);
        toast.error(i ? `${i} bulan ditutup. Berhenti di ${m.label}: ${r.error}` : r.error);
        setPreview(null);
        router.refresh();
        return;
      }
    }
    setProgress(null);
    toast.success(`${closable.length} bulan ditutup (${span})`);
    setPreview(null);
    router.refresh();
  };
  const monthKey = (m: { year: number; month: number }) => `${m.year}-${String(m.month).padStart(2, "0")}`;

  return (
    <Card data-testid="close-history">
      <CardHeader>
        <CardTitle>Tutup bulan-bulan sebelumnya</CardTitle>
        <CardDescription>
          {props.count} bulan sebelum {props.periodLabel} masih terbuka ({props.range}). Penutupan berurutan dari bulan paling awal; untuk riwayat
          yang sudah ditutup di sistem lama, periksa semuanya sekaligus lalu tutup dengan satu catatan.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!preview && (
          <Button variant="outline" onClick={check} disabled={checking} data-testid="history-check">
            {checking ? <><Loader2 className="animate-spin" /> Memeriksa {props.count} bulan…</> : `Periksa ${props.count} bulan`}
          </Button>
        )}
        {preview && (
          <>
            <ul className="divide-y rounded-lg border" data-testid="history-months">
              {preview.months.map((m) => (
                <li key={monthKey(m)} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                  <span className="w-32 shrink-0 font-medium">{m.label}</span>
                  <StatusPill status={m.status === "FAIL" ? "FAIL" : m.status === "NOTE" ? "REVIEW" : "PASS"} label={m.status === "FAIL" ? "Gagal" : m.status === "NOTE" ? `${m.toNote.length} perlu catatan` : "Siap"} />
                  <span className="min-w-0 flex-1 basis-60 text-muted-foreground">
                    {m.status === "FAIL" ? m.fails.map((c) => `${c.title} · ${c.scope}: ${c.detail}`).join("; ") : m.toNote.map((c) => `${c.title} · ${c.scope}`).join(", ")}
                  </span>
                </li>
              ))}
            </ul>
            {stop && (
              <p className="text-sm" data-testid="history-stop">
                Berhenti di <span className="font-medium">{stop.label}</span>: ada kontrol gagal, perbaiki dari{" "}
                <Link href={`${props.base}/close?period=${monthKey(stop)}`} className="text-primary hover:underline">Tutup Buku {stop.label}</Link>.
                {preview.blocked && ` ${preview.blocked.count} bulan setelahnya (mulai ${preview.blocked.from}) menunggu.`}
              </p>
            )}
            {closable.length > 0 && preview.groups.length > 0 && (
              <div className="text-sm">
                <div className="font-medium">Catatan Anda menjawab kontrol berikut</div>
                <ul className="mt-1 space-y-0.5 text-muted-foreground" data-testid="history-groups">
                  {preview.groups.map((g) => <li key={`${g.title}·${g.scope}`}>• {g.title} · {g.scope} — {g.months} bulan</li>)}
                </ul>
              </div>
            )}
            {closable.length > 0 && !props.isAdmin && (
              <p className="text-sm text-muted-foreground">Hanya admin kantor yang dapat menutup beberapa bulan sekaligus. Bulan-bulan ini tetap bisa ditutup satu per satu.</p>
            )}
            {closable.length > 0 && props.isAdmin && (
              <div className="space-y-3">
                <Field>
                  <FieldLabel htmlFor="history-note">Catatan untuk {closable.length} bulan</FieldLabel>
                  <Textarea id="history-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} disabled={progress !== null} data-testid="history-note"
                    placeholder="mis. Riwayat dari Accurate, sudah ditutup dan diperiksa di sana; Buku membawanya apa adanya" />
                  <FieldDescription>Ditulis pada setiap kontrol “Perlu dicek” yang belum bercatatan (min. {NOTE_MIN} karakter). Catatan yang sudah ada tidak diganti.</FieldDescription>
                </Field>
                <div className="space-y-2">
                  {props.signoffs.map((s) => (
                    <div key={s.key} className="flex items-start gap-2 text-sm">
                      <Checkbox id={`history-${s.key}`} checked={ticked.includes(s.key)} disabled={progress !== null} className="mt-0.5"
                        onCheckedChange={(v) => setTicked((t) => (v ? [...t, s.key] : t.filter((k) => k !== s.key)))} />
                      <label htmlFor={`history-${s.key}`} className="cursor-pointer">{s.label} — untuk setiap bulan</label>
                    </div>
                  ))}
                </div>
                {progress ? (
                  <div className="space-y-1.5" data-testid="history-progress">
                    <Progress value={(progress.done / closable.length) * 100} />
                    <p className="text-sm text-muted-foreground">Menutup {progress.current} · {progress.done + 1} dari {closable.length}</p>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={!ready} onClick={() => setConfirm(true)} data-testid="history-close"><Lock /> Tutup {closable.length} bulan</Button>
                    <Button variant="ghost" onClick={() => setPreview(null)}>Batal</Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tutup {closable.length} bulan ({span})?</DialogTitle>
            <DialogDescription>
              Setiap bulan dikunci berurutan: impor, reklasifikasi dan jurnal ke bulan itu ditolak sampai dibuka kembali (admin, dari bulan terakhir).
              Catatan dan daftar periksa tersimpan atas nama Anda di setiap bulan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>Batal</Button>
            <Button onClick={run} data-testid="history-confirm">Tutup {closable.length} bulan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
