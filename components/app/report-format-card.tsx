"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ChevronRight, Trash2, X } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { resetReportFormatAction, saveReportFormatAction } from "@/app/actions";
import type { FormatLine, ReportFormat, StatementKey } from "@/lib/reports/format";
import { cn } from "@/lib/utils";

type Universe = Record<StatementKey, { line: string; label: string }[]>;

const KIND_LABEL: Record<FormatLine["kind"], string> = { HEADING: "Judul", GROUP: "Pos", TOTAL: "Total" };
const STATEMENTS: { key: StatementKey; label: string }[] = [
  { key: "labaRugi", label: "Laba Rugi" },
  { key: "neraca", label: "Neraca" },
];

/**
 * *Format laporan* (UC-K3): the client's own labels, order, headings and totals for the Laba Rugi and the Neraca. Presentation only; the
 * server checks every save (each Buku line exactly once, totals over lines above them, the results right) and names the line it refuses.
 */
export function ReportFormatCard({ clientId, initial, custom, stale, universe }: { clientId: string; initial: ReportFormat; custom: boolean; stale?: string; universe: Universe }) {
  const router = useRouter();
  const [format, setFormat] = useState<ReportFormat>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const dirty = JSON.stringify(format) !== JSON.stringify(initial);

  const setLines = (st: StatementKey, f: (lines: FormatLine[]) => FormatLine[]) => setFormat((v) => ({ ...v, [st]: f(v[st]) }));
  const update = (st: StatementKey, key: string, patch: Partial<FormatLine>) =>
    setLines(st, (ls) => ls.map((l) => (l.key === key ? ({ ...l, ...patch } as FormatLine) : l)));
  const move = (st: StatementKey, i: number, by: -1 | 1) =>
    setLines(st, (ls) => {
      const j = i + by;
      if (j < 0 || j >= ls.length) return ls;
      const next = [...ls];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  // A removed line leaves the totals that summed it; its Buku lines show as not yet placed.
  const remove = (st: StatementKey, key: string) =>
    setLines(st, (ls) => ls.filter((l) => l.key !== key).map((l) => (l.kind === "TOTAL" ? { ...l, terms: l.terms.filter((t) => t.key !== key) } : l)));
  const add = (st: StatementKey, kind: FormatLine["kind"]) => {
    const key = `${kind.toLowerCase()}_${Date.now().toString(36)}_${seq.current++}`;
    const line: FormatLine = kind === "HEADING" ? { key, kind, label: "Judul baru" } : kind === "GROUP" ? { key, kind, label: "Pos baru", lines: [] } : { key, kind, label: "Total baru", terms: [] };
    setLines(st, (ls) => [...ls, line]);
  };

  async function save() {
    setBusy(true);
    const r = await saveReportFormatAction(clientId, { ...format, source: format.source?.trim() || undefined });
    setBusy(false);
    if (!r.ok) return void setError(r.error);
    setError(null);
    toast.success("Format laporan disimpan");
    router.refresh();
  }
  async function reset() {
    setBusy(true);
    const r = await resetReportFormatAction(clientId);
    setBusy(false);
    if (!r.ok) return void setError(r.error);
    setError(null);
    toast.success("Format laporan kembali ke standar");
    router.refresh();
  }

  return (
    <Card data-testid="report-format-card">
      <CardHeader>
        <CardTitle>Format laporan</CardTitle>
        <CardDescription>
          Label, urutan, judul dan total Laba Rugi dan Neraca, seperti laporan final klien. Hanya tampilan: angka tetap dari buku besar dan
          setiap akun tetap tampil. {custom ? "Klien ini memakai formatnya sendiri." : "Klien ini memakai format standar Buku."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {stale && (
          <p role="status" className="text-sm text-review" data-testid="format-stale">
            Format klien yang tersimpan tidak berlaku lagi, jadi laporan memakai format standar: {stale} Susun ulang formatnya, atau kembali ke format standar.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="format-unit">Satuan</FieldLabel>
            <Select value={format.unit} onValueChange={(v) => setFormat((f) => ({ ...f, unit: v as ReportFormat["unit"] }))}>
              <SelectTrigger id="format-unit" className="w-full" aria-label="Satuan"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="RUPIAH">Rupiah penuh</SelectItem>
                <SelectItem value="RIBUAN">Ribuan Rupiah</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="format-source">Sumber format</FieldLabel>
            <Input id="format-source" value={format.source ?? ""} maxLength={200} placeholder="mis. Laporan Keuangan 2025 final" onChange={(e) => setFormat((f) => ({ ...f, source: e.target.value }))} />
          </Field>
        </div>
        <Collapsible defaultOpen={false}>
          <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            <ChevronRight className="size-4 transition-transform group-data-[panel-open]:rotate-90" aria-hidden />
            Ubah baris Laba Rugi dan Neraca
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <Tabs defaultValue="labaRugi">
              <TabsList>
                {STATEMENTS.map((s) => <TabsTrigger key={s.key} value={s.key}>{s.label}</TabsTrigger>)}
              </TabsList>
              {STATEMENTS.map((s) => (
                <TabsContent key={s.key} value={s.key} className="space-y-2 pt-2">
                  <Statement
                    st={s.key}
                    lines={format[s.key]}
                    universe={universe[s.key]}
                    onUpdate={(key, patch) => update(s.key, key, patch)}
                    onMove={(i, by) => move(s.key, i, by)}
                    onRemove={(key) => remove(s.key, key)}
                  />
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button variant="outline" size="sm" onClick={() => add(s.key, "HEADING")}>Tambah judul</Button>
                    <Button variant="outline" size="sm" onClick={() => add(s.key, "GROUP")}>Tambah pos</Button>
                    <Button variant="outline" size="sm" onClick={() => add(s.key, "TOTAL")}>Tambah total</Button>
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </CollapsibleContent>
        </Collapsible>
        {error && <p role="alert" className="text-sm text-fail" data-testid="format-error">{error}</p>}
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button onClick={save} disabled={busy || !dirty}>Simpan format</Button>
          {dirty && <Button variant="ghost" onClick={() => { setFormat(initial); setError(null); }} disabled={busy}>Batalkan perubahan</Button>}
          {(custom || stale) && <Button variant="outline" onClick={reset} disabled={busy}>Kembali ke format standar</Button>}
        </div>
      </CardContent>
    </Card>
  );
}

function Statement({ st, lines, universe, onUpdate, onMove, onRemove }: {
  st: StatementKey;
  lines: FormatLine[];
  universe: { line: string; label: string }[];
  onUpdate: (key: string, patch: Partial<FormatLine>) => void;
  onMove: (i: number, by: -1 | 1) => void;
  onRemove: (key: string) => void;
}) {
  const nameOf = new Map(universe.map((u) => [u.line, u.label]));
  const placed = new Set(lines.flatMap((l) => (l.kind === "GROUP" ? l.lines : [])));
  const unplaced = universe.filter((u) => !placed.has(u.line));
  return (
    <>
      {unplaced.length > 0 && (
        <p className="text-sm text-review" data-testid="format-unplaced">
          Belum ditempatkan: {unplaced.map((u) => u.label).join(", ")}. Masukkan ke salah satu pos supaya tidak ada akun yang hilang dari laporan.
        </p>
      )}
      <ol className="space-y-2">
        {lines.map((l, i) => {
          const id = `${st}-${l.key}`;
          const earlier = lines.slice(0, i).filter((x) => x.kind !== "HEADING");
          return (
            <li key={l.key} className={cn("space-y-2 border p-3", l.kind === "HEADING" && "bg-muted/40")} data-testid="format-line">
              <div className="flex flex-wrap items-center gap-2">
                <span className="eyebrow w-12 shrink-0">{KIND_LABEL[l.kind]}</span>
                <Input
                  aria-label={`Label baris ${i + 1}`}
                  className={cn("min-w-0 flex-1 basis-48", l.kind === "TOTAL" && l.caps && "uppercase", l.kind === "TOTAL" && l.strong && "font-semibold")}
                  value={l.label}
                  maxLength={120}
                  onChange={(e) => onUpdate(l.key, { label: e.target.value })}
                />
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label={`Naikkan ${l.label}`} disabled={i === 0} onClick={() => onMove(i, -1)}><ArrowUp /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Turunkan ${l.label}`} disabled={i === lines.length - 1} onClick={() => onMove(i, 1)}><ArrowDown /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Hapus ${l.label}`} onClick={() => onRemove(l.key)}><Trash2 /></Button>
                </div>
              </div>
              {l.kind === "GROUP" && (
                <div className="flex flex-wrap items-center gap-2 sm:pl-14">
                  {l.lines.map((f) => (
                    <Chip key={f} label={nameOf.get(f) ?? f} onRemove={() => onUpdate(l.key, { lines: l.lines.filter((x) => x !== f) })} />
                  ))}
                  {unplaced.length > 0 && (
                    <Select value={null} onValueChange={(v) => v && onUpdate(l.key, { lines: [...l.lines, v as string] })}>
                      <SelectTrigger size="sm" className="w-56" aria-label={`Tambah pos buku ke ${l.label}`}><SelectValue placeholder="Tambah pos buku" /></SelectTrigger>
                      <SelectContent>{unplaced.map((u) => <SelectItem key={u.line} value={u.line}>{u.label}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                  <span className="flex items-center gap-2 text-sm">
                    <Checkbox id={`${id}-neg`} checked={l.sign === -1} onCheckedChange={(v) => onUpdate(l.key, { sign: v === true ? -1 : undefined })} />
                    <label htmlFor={`${id}-neg`}>Tampil negatif</label>
                  </span>
                </div>
              )}
              {l.kind === "TOTAL" && (
                <div className="flex flex-wrap items-center gap-2 sm:pl-14">
                  {l.terms.map((t) => {
                    const name = lines.find((x) => x.key === t.key)?.label ?? t.key;
                    return (
                      <span key={t.key} className="inline-flex items-center border text-sm">
                        <button
                          type="button"
                          className="num px-2 py-0.5 font-medium text-primary hover:bg-muted"
                          aria-label={`Ubah tanda ${name}`}
                          onClick={() => onUpdate(l.key, { terms: l.terms.map((x) => (x.key === t.key ? { ...x, sign: x.sign === 1 ? -1 : 1 } : x)) })}
                        >
                          {t.sign === 1 ? "+" : "−"}
                        </button>
                        <span className="py-0.5 pr-1">{name}</span>
                        <button type="button" className="px-1 py-0.5 text-muted-foreground hover:text-foreground" aria-label={`Lepas ${name}`} onClick={() => onUpdate(l.key, { terms: l.terms.filter((x) => x.key !== t.key) })}>
                          <X className="size-3.5" />
                        </button>
                      </span>
                    );
                  })}
                  {earlier.some((x) => !l.terms.some((t) => t.key === x.key)) && (
                    <Select value={null} onValueChange={(v) => v && onUpdate(l.key, { terms: [...l.terms, { key: v as string, sign: 1 }] })}>
                      <SelectTrigger size="sm" className="w-56" aria-label={`Tambah baris ke ${l.label}`}><SelectValue placeholder="Jumlahkan baris" /></SelectTrigger>
                      <SelectContent>{earlier.filter((x) => !l.terms.some((t) => t.key === x.key)).map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                  <span className="flex items-center gap-2 text-sm">
                    <Checkbox id={`${id}-strong`} checked={!!l.strong} onCheckedChange={(v) => onUpdate(l.key, { strong: v === true || undefined })} />
                    <label htmlFor={`${id}-strong`}>Tebal</label>
                  </span>
                  <span className="flex items-center gap-2 text-sm">
                    <Checkbox id={`${id}-caps`} checked={!!l.caps} onCheckedChange={(v) => onUpdate(l.key, { caps: v === true || undefined })} />
                    <label htmlFor={`${id}-caps`}>Huruf kapital</label>
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 border bg-muted/40 py-0.5 pl-2 text-sm">
      {label}
      <button type="button" className="px-1 text-muted-foreground hover:text-foreground" aria-label={`Lepas ${label}`} onClick={onRemove}>
        <X className="size-3.5" />
      </button>
    </span>
  );
}
