"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/app/status";
import { NextAfterImport } from "@/components/app/next-after-import";
import { importAction, peekStatementAction } from "@/app/actions";
import { planBatch } from "@/lib/import/batch-plan";
import type { PeekLine, PeekResult } from "@/lib/import/peek";
import type { ImportSummary } from "@/lib/import/pipeline";
import { formatDate, formatPeriod } from "@/lib/format";
import { MAX_UPLOAD_BYTES, UPLOAD_TOO_BIG } from "@/lib/upload";

export type BankOption = { id: string; label: string; entity: string; bank: string; number: string };

/** More than this and the table stops being readable on a phone and a run takes minutes: the rest are asked for in a second go. */
export const BATCH_MAX = 24;
const ALLOWED = /\.(pdf|csv|xlsx|xls|txt|sta|940|mt940|jpg|jpeg|png)$/i;

type Entry = { id: number; file: File; password: string; year: string; peek: "reading" | PeekResult };
type Outcome = "running" | { ok: true; summary: ImportSummary } | { ok: false; error: string };
type Row = { key: string; entry: Entry; line: PeekLine; bankId: string | null };

const importable = (l: PeekLine) => l.status === "READY" || l.status === "PICK";
/** "Mei 2026" for a whole month, "Mei – Jul 2026" for whole months, else the dates. */
function range(l: PeekLine) {
  const s = new Date(l.periodStart);
  const e = new Date(l.periodEnd);
  const wholeMonths = s.getUTCDate() === 1 && new Date(e.getTime() + 86_400_000).getUTCDate() === 1;
  if (!wholeMonths) return l.periodStart === l.periodEnd ? formatDate(s) : `${formatDate(s)} – ${formatDate(e)}`;
  const first = formatPeriod(s.getUTCFullYear(), s.getUTCMonth() + 1);
  if (s.getUTCFullYear() === e.getUTCFullYear() && s.getUTCMonth() === e.getUTCMonth()) return first;
  return `${first} – ${formatPeriod(e.getUTCFullYear(), e.getUTCMonth() + 1)}`;
}

/**
 * Several statements at once: every file is read first (nothing written), matched to the client's account by the number inside it and
 * ordered oldest first per account; then they are imported one after another through the same `importAction` as a single file.
 */
export function BatchImport({ clientId, banks, files, defaultBankId, openingPending, onClear, onSingle }: { clientId: string; banks: BankOption[]; files: File[]; defaultBankId: string; openingPending: boolean; onClear: () => void; onSingle: (file: File) => void }) {
  const router = useRouter();
  const shown = files.slice(0, BATCH_MAX);
  const [entries, setEntries] = useState<Entry[]>(() => shown.map((file, id) => ({ id, file, password: "", year: "", peek: "reading" })));
  const [pick, setPick] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const stop = useRef(false);
  const bankLabel = (id: string | null) => {
    const b = banks.find((x) => x.id === id);
    return b ? `${b.label} · ${b.number}` : "";
  };

  const patch = (id: number, p: Partial<Entry>) => setEntries((all) => all.map((e) => (e.id === id ? { ...e, ...p } : e)));
  const read = async (e: Entry, password = e.password, year = e.year): Promise<void> => {
    patch(e.id, { peek: "reading", password, year });
    let peek: PeekResult;
    if (!ALLOWED.test(e.file.name)) peek = { ok: false, kind: "ERROR", error: "Jenis file ini tidak didukung. Pakai PDF, CSV, Excel atau MT940." };
    else if (e.file.size > MAX_UPLOAD_BYTES) peek = { ok: false, kind: "ERROR", error: UPLOAD_TOO_BIG };
    else if (e.file.size === 0) peek = { ok: false, kind: "ERROR", error: "File kosong." };
    else {
      const fd = new FormData();
      fd.set("clientId", clientId);
      fd.set("file", e.file);
      if (password) fd.set("password", password);
      if (year) fd.set("year", year);
      try {
        peek = await peekStatementAction(fd);
      } catch {
        peek = { ok: false, kind: "ERROR", error: "File tidak bisa dibaca sekarang. Coba lagi." };
      }
    }
    patch(e.id, { peek });
  };

  // Read every file once, one at a time, as soon as the table opens (a batch is mounted per choice of files).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const e of entries) {
        if (cancelled) return;
        await read(e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Once per batch: later reads are the accountant's answers (password, year).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows: Row[] = entries.flatMap((entry) =>
    entry.peek !== "reading" && entry.peek.ok
      ? entry.peek.lines.map((line, i) => {
          const key = `${entry.id}:${i}`;
          return { key, entry, line, bankId: importable(line) ? (pick[key] ?? line.bankAccountId ?? (line.status === "PICK" ? defaultBankId : null)) : null };
        })
      : [],
  );
  const queue = planBatch(
    rows.filter((r) => r.bankId).map((r) => ({ ...r, bankAccountId: r.bankId, periodStart: r.line.periodStart })),
    banks.map((b) => b.id),
  );
  const refused = rows.filter((r) => !r.bankId);
  const unread = entries.filter((e) => e.peek !== "reading" && !e.peek.ok);
  const reading = entries.filter((e) => e.peek === "reading").length;
  const needsAttention = unread.length + refused.length;

  const importAll = async () => {
    setRunning(true);
    setFinished(false);
    stop.current = false;
    let last: ImportSummary | null = null;
    for (const r of queue) {
      if (stop.current) break;
      const before = outcomes[r.key];
      if (before && before !== "running" && before.ok) continue; // imported in an earlier go
      setOutcomes((o) => ({ ...o, [r.key]: "running" }));
      const fd = new FormData();
      fd.set("clientId", clientId);
      fd.set("bankAccountId", r.bankId!);
      fd.set("file", r.entry.file);
      if (r.entry.password) fd.set("password", r.entry.password);
      if (r.entry.year) fd.set("year", r.entry.year);
      let outcome: Outcome;
      try {
        const res = await importAction(fd);
        outcome = res.ok ? { ok: true, summary: res.summary } : { ok: false, error: res.error };
        if (res.ok) last = res.summary;
      } catch {
        outcome = { ok: false, error: "Koneksi terputus. File ini belum diimpor; coba lagi." };
      }
      setOutcomes((o) => ({ ...o, [r.key]: outcome }));
    }
    setRunning(false);
    setFinished(true);
    router.refresh();
    if (last) toast.success("Impor selesai");
  };

  const results = Object.values(outcomes).filter((o): o is Exclude<Outcome, "running"> => o !== "running");
  const okResults = results.filter((o): o is { ok: true; summary: ImportSummary } => o.ok);
  const already = okResults.filter((o) => o.summary.rows - o.summary.duplicates === 0).length;
  const failed = results.length - okResults.length;
  const fresh = okResults.reduce((n, o) => n + o.summary.rows - o.summary.duplicates, 0);
  const lastSummary = okResults.at(-1)?.summary ?? null;
  const doneCount = results.length;
  const current = queue.find((r) => outcomes[r.key] === "running");

  return (
    <Card className="lg:col-span-5" data-testid="batch-import">
      <CardHeader>
        <CardTitle>Impor {files.length} file</CardTitle>
        <CardDescription>
          Buku membaca dulu setiap file, mencocokkannya ke rekening lewat nomor di dalam file, lalu mengimpor dari bulan terlama. Belum ada yang tersimpan.
          {files.length > BATCH_MAX && ` Hanya ${BATCH_MAX} file pertama dibaca; sisanya bisa diunggah setelah ini selesai.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {reading > 0 && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Membaca file… {entries.length - reading} dari {entries.length}
          </p>
        )}

        {needsAttention > 0 && reading === 0 && (
          <section className="space-y-2" aria-label="Perlu ditangani" data-testid="batch-attention">
            <h3 className="eyebrow">{needsAttention} perlu ditangani — file lain tetap bisa diimpor</h3>
            <ul className="divide-y rounded-lg border bg-card text-sm">
              {unread.map((e) => (
                <li key={e.id} className="space-y-2 px-3 py-2.5">
                  <div className="font-medium [overflow-wrap:anywhere]">{e.file.name}</div>
                  <p className="text-review">{(e.peek as Extract<PeekResult, { ok: false }>).error}</p>
                  <Unread entry={e} onRead={(pw, year) => read(e, pw, year)} onSingle={() => onSingle(e.file)} />
                </li>
              ))}
              {refused.map((r) => (
                <li key={r.key} className="space-y-1 px-3 py-2.5">
                  <div className="font-medium [overflow-wrap:anywhere]">{r.entry.file.name}{r.line.label && <span className="font-normal text-muted-foreground"> · {r.line.label}</span>}</div>
                  <p className="text-review">{r.line.note}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {queue.length > 0 && (
          <section className="space-y-2" aria-label="Siap diimpor" data-testid="batch-queue">
            <h3 className="eyebrow">{queue.length} siap diimpor, dari bulan terlama</h3>
            <ul className="divide-y rounded-lg border bg-card text-sm">
              {queue.map((r) => {
                const o = outcomes[r.key];
                return (
                  <li key={r.key} className="grid gap-x-4 gap-y-1 px-3 py-2.5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.1fr)] md:items-center" data-testid="batch-row">
                    <div className="min-w-0">
                      <div className="font-medium [overflow-wrap:anywhere]">{r.entry.file.name}</div>
                      {r.line.label && <div className="text-xs text-muted-foreground">{r.line.label}</div>}
                    </div>
                    <div className="min-w-0">
                      {r.line.number === null ? (
                        <Select value={r.bankId!} onValueChange={(v) => setPick((p) => ({ ...p, [r.key]: v as string }))} disabled={running || !!o}>
                          <SelectTrigger size="sm" className="w-full" aria-label={`Rekening untuk ${r.entry.file.name}`}>
                            <SelectValue>{bankLabel(r.bankId)}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {banks.map((b) => (
                              <SelectItem key={b.id} value={b.id}>
                                {b.label} · {b.number}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span>{bankLabel(r.bankId)}</span>
                      )}
                      {r.line.number === null && r.line.note && <div className="mt-0.5 text-xs text-muted-foreground">{r.line.note}</div>}
                    </div>
                    <div className="text-muted-foreground">
                      <div className="num">{range(r.line)}</div>
                      <div className="text-xs">{r.line.rows} baris</div>
                    </div>
                    <div data-testid="batch-status">
                      <RowStatus outcome={o} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {finished && (
          <section className="space-y-3 rounded-lg bg-muted px-4 py-3 text-sm" aria-label="Hasil impor" data-testid="batch-summary">
            <p>
              <span className="font-medium">{okResults.length - already} file diimpor</span>
              {already > 0 && <> · {already} sudah ada</>}
              {failed > 0 && <span className="text-review"> · {failed} gagal</span>}
              <> · <span className="num">{fresh}</span> transaksi baru</>
            </p>
            {lastSummary && <NextAfterImport clientId={clientId} toReview={lastSummary.needsReview || lastSummary.pendingReview} openingPending={openingPending} />}
          </section>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {!(finished && failed === 0 && !running) && (
            <Button onClick={importAll} disabled={running || reading > 0 || queue.length === 0}>
              {running ? <Loader2 className="animate-spin" /> : <FileUp />}
              {running ? `Mengimpor ${doneCount + 1} dari ${queue.length}${current ? ` · ${current.entry.file.name}` : ""}` : finished ? "Coba lagi yang gagal" : `Impor ${queue.length} file`}
            </Button>
          )}
          {running ? (
            <Button variant="outline" onClick={() => (stop.current = true)}>Berhenti setelah file ini</Button>
          ) : (
            <Button variant="outline" onClick={onClear}>{finished ? "Selesai" : "Batalkan"}</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RowStatus({ outcome }: { outcome: Outcome | undefined }) {
  if (!outcome) return <span className="text-muted-foreground">Menunggu</span>;
  if (outcome === "running") return <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" aria-hidden /> Mengimpor…</span>;
  if (!outcome.ok) return <p className="text-xs text-review [overflow-wrap:anywhere]">{outcome.error}</p>;
  const s = outcome.summary;
  const fresh = s.rows - s.duplicates;
  if (fresh === 0) return <span className="text-muted-foreground">Sudah ada, tidak ada yang baru</span>;
  return (
    <div className="space-y-0.5">
      <StatusPill status={s.continuityOk ? "PASS" : "REVIEW"} label={s.continuityOk ? "Saldo nyambung" : "Ada celah"} />
      <div className="text-xs text-muted-foreground"><span className="num">{fresh}</span> baru{s.duplicates > 0 && <> · {s.duplicates} sudah ada</>}{s.needsReview > 0 && <> · <span className="num">{s.needsReview}</span> perlu review</>}</div>
      {s.continuityNote && <div className="text-xs text-review">{s.continuityNote}</div>}
    </div>
  );
}

/** What a file that couldn't be read yet needs from the accountant, answered on its own row. */
function Unread({ entry, onRead, onSingle }: { entry: Entry; onRead: (password: string, year: string) => void; onSingle: () => void }) {
  const [password, setPassword] = useState(entry.password);
  const [year, setYear] = useState(entry.year);
  const peek = entry.peek as Extract<PeekResult, { ok: false }>;
  if (peek.kind === "PASSWORD") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Input type="password" autoComplete="off" aria-label={`Kata sandi ${entry.file.name}`} className="w-48" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && password && onRead(password, entry.year)} />
        <Button size="sm" variant="outline" disabled={!password} onClick={() => onRead(password, entry.year)}>Baca lagi</Button>
        <span className="text-xs text-muted-foreground">Hanya dipakai untuk membuka file ini, tidak disimpan.</span>
      </div>
    );
  }
  if (peek.kind === "YEAR") {
    const guess = peek.yearGuess ? String(peek.yearGuess) : "";
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Input inputMode="numeric" maxLength={4} aria-label={`Tahun bulan pertama ${entry.file.name}`} className="w-24" placeholder={guess || "2026"} value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && year.length === 4 && onRead(entry.password, year)} />
        <Button size="sm" variant="outline" disabled={year.length !== 4} onClick={() => onRead(entry.password, year)}>Baca lagi</Button>
        <span className="text-xs text-muted-foreground">Tahun bulan pertama di file{guess && `, mungkin ${guess}`}.</span>
      </div>
    );
  }
  if (peek.kind === "SCAN" || peek.kind === "UNREADABLE") {
    return (
      <Button size="sm" variant="outline" onClick={onSingle}>
        {peek.kind === "SCAN" ? "Tangani satu per satu (Baca scan dengan AI)" : "Tangani satu per satu (Atur kolom)"}
      </Button>
    );
  }
  return null;
}
