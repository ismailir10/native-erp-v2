"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronRight, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Money } from "@/components/app/money";
import { StatusPill } from "@/components/app/status";
import { deleteSubledgerImportAction, importAgingAction, resolveSubledgerFindingAction } from "@/app/actions";
import { formatMoney } from "@/lib/money";

type Kind = "RECEIVABLE" | "PAYABLE";
type Amount = { code: string; name: string; balance: string };
export type ReconView = {
  importId: string;
  entityId: string;
  entity: string;
  kind: Kind;
  asOf: string;
  periodKey: string;
  fileName: string;
  threshold: string;
  aging: string;
  ledger: string;
  difference: string;
  percent: number | null;
  status: "MATCH" | "ROUNDING" | "DIFFERENCE";
  accounts: Amount[];
  rows: { counterparty: string; total: string; sourceRef: string; rounded: boolean }[];
  counterparties: { name: string; aging: string; buku: string; difference: string; sourceRef: string | null }[] | null;
  candidates: {
    cutoff: { date: string; memo: string; code: string; amount: string; source: string | null }[];
    credits: { counterparty: string; total: string; sourceRef: string }[];
    advances: Amount[];
    nonTrade: Amount[];
  };
  finding: { id: string; label: string; status: "OPEN" | "RESOLVED"; resolution: string | null } | null;
};

const KIND: Record<Kind, string> = { RECEIVABLE: "Piutang", PAYABLE: "Utang" };
const EXPLAIN_MIN = 10;

/**
 * Rekonsiliasi subledger (UC-A1): the client's own aging against the ledger. Upload an aging per date; each comparison shows the
 * difference with its percent, the candidate causes with their sources, and the Temuan to explain. Nothing here posts a journal.
 */
export function SubledgerRecon({ clientId, base, entities, accountOptions, defaultAsOf, views }: {
  clientId: string;
  base: string;
  entities: { id: string; name: string }[];
  accountOptions: Record<Kind, { code: string; name: string; checked: boolean }[]>;
  defaultAsOf: string;
  views: ReconView[];
}) {
  const router = useRouter();
  const [chosen, setEntityId] = useState(entities[0]?.id ?? "");
  // The scope bar can change the entities under a mounted form: a choice outside them falls back to the first.
  const entityId = entities.some((e) => e.id === chosen) ? chosen : (entities[0]?.id ?? "");
  const [kind, setKind] = useState<Kind>("RECEIVABLE");
  const [asOf, setAsOf] = useState(defaultAsOf);
  const [threshold, setThreshold] = useState("1.000");
  const [file, setFile] = useState<File | null>(null);
  const [picked, setPicked] = useState<Record<Kind, string[]>>({
    RECEIVABLE: accountOptions.RECEIVABLE.filter((a) => a.checked).map((a) => a.code),
    PAYABLE: accountOptions.PAYABLE.filter((a) => a.checked).map((a) => a.code),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    const fd = new FormData();
    fd.set("clientId", clientId);
    fd.set("entityId", entityId);
    fd.set("kind", kind);
    fd.set("asOf", asOf);
    fd.set("threshold", threshold);
    fd.set("file", file);
    for (const c of picked[kind]) fd.append("accounts", c);
    setBusy(true);
    const r = await importAgingAction(fd);
    setBusy(false);
    if (!r.ok) return void setError(r.error);
    setError(null);
    setFile(null);
    const diff = BigInt(r.difference);
    toast.success(r.status === "DIFFERENCE" ? `Selisih ${formatMoney(diff, "IDR")}: temuan dibuka` : r.status === "ROUNDING" ? `Cocok dalam batas pembulatan (${formatMoney(diff, "IDR")})` : "Cocok dengan buku besar", { description: [`${r.rows} baris dibaca`, ...r.notes].join(" · ") });
    router.refresh();
  }

  return (
    <div className="space-y-4" data-testid="subledger-recon">
      <Card>
        <CardHeader>
          <CardTitle>Bandingkan aging klien dengan buku besar</CardTitle>
          <CardDescription>Unggah aging piutang atau utang dari sistem klien (XLSX, XLS atau CSV). Buku membandingkan totalnya dengan saldo akun per tanggal itu dan menunjukkan kandidat penyebab selisih.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {entities.length === 0 && <p className="text-sm text-muted-foreground" data-testid="recon-no-entity">Tidak ada entitas berbuku Rupiah di cakupan ini. Pilih entitas lain di atas; rekonsiliasi aging baru untuk pembukuan Rupiah.</p>}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field>
              <FieldLabel htmlFor="recon-entity">Entitas</FieldLabel>
              <Select value={entityId} onValueChange={(v) => setEntityId(v as string)}>
                <SelectTrigger id="recon-entity" className="w-full"><SelectValue>{entities.find((e) => e.id === entityId)?.name}</SelectValue></SelectTrigger>
                <SelectContent>{entities.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="recon-kind">Jenis</FieldLabel>
              <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
                <SelectTrigger id="recon-kind" className="w-full"><SelectValue>{KIND[kind]}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="RECEIVABLE">Piutang</SelectItem>
                  <SelectItem value="PAYABLE">Utang</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="recon-asof">Per tanggal</FieldLabel>
              <Input id="recon-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="recon-threshold">Batas pembulatan</FieldLabel>
              <Input id="recon-threshold" inputMode="decimal" className="num text-right" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
              <FieldDescription>Selisih sampai nominal ini dianggap pembulatan.</FieldDescription>
            </Field>
          </div>
          <Field>
            <FieldLabel>Akun yang dibandingkan</FieldLabel>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {accountOptions[kind].map((a) => (
                <span key={a.code} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id={`recon-acc-${a.code}`}
                    checked={picked[kind].includes(a.code)}
                    onCheckedChange={(v) => setPicked((p) => ({ ...p, [kind]: v === true ? [...p[kind], a.code] : p[kind].filter((c) => c !== a.code) }))}
                  />
                  <label htmlFor={`recon-acc-${a.code}`}><span className="num">{a.code}</span> {a.name}</label>
                </span>
              ))}
            </div>
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Input type="file" accept=".xlsx,.xls,.csv" aria-label="File aging" className="max-w-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Button onClick={upload} disabled={busy || !file || !entityId || !asOf || picked[kind].length === 0} data-testid="recon-upload">
              <Upload /> {busy ? "Membandingkan…" : "Unggah dan bandingkan"}
            </Button>
          </div>
          {error && <p role="alert" className="text-sm text-fail" data-testid="recon-error">{error}</p>}
        </CardContent>
      </Card>
      {views.length === 0 ? (
        <p className="rounded-lg border bg-card px-4 py-6 text-center text-sm text-muted-foreground">Belum ada aging yang dibandingkan untuk cakupan ini.</p>
      ) : (
        // What needs attention first (ui-rules 10): an open Temuan, then a difference already explained, then the matching ones.
        [...views].sort((a, b) => rank(a) - rank(b)).map((v) => <ReconCard key={v.importId} clientId={clientId} base={base} v={v} />)
      )}
    </div>
  );
}

const rank = (v: ReconView) => (v.finding?.status === "OPEN" ? 0 : v.status === "DIFFERENCE" ? 1 : 2);

function ReconCard({ clientId, base, v }: { clientId: string; base: string; v: ReconView }) {
  const router = useRouter();
  const [explanation, setExplanation] = useState("");
  const [busy, setBusy] = useState(false);
  const ledgerHref = (code: string) => `${base}/ledger/${code}?period=${v.periodKey}&entity=${v.entityId}`;
  const diff = BigInt(v.difference);
  const pill = v.status === "DIFFERENCE" ? { status: "REVIEW" as const, label: "Selisih" } : { status: "PASS" as const, label: v.status === "ROUNDING" ? `Pembulatan ${formatMoney(diff, "IDR")}` : "Cocok" };
  const c = v.candidates;

  async function resolve() {
    if (!v.finding) return;
    setBusy(true);
    const r = await resolveSubledgerFindingAction({ clientId, findingId: v.finding.id, explanation });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(`${v.finding.label} ditutup`);
    router.refresh();
  }
  async function remove() {
    setBusy(true);
    const r = await deleteSubledgerImportAction(clientId, v.importId);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Impor aging dihapus");
    router.refresh();
  }

  return (
    <Card data-testid="recon-card">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Aging {KIND[v.kind].toLowerCase()} · {v.entity} · per {v.asOf}
              <StatusPill status={pill.status} label={pill.label} />
            </CardTitle>
            <CardDescription>{v.fileName} · {v.rows.length} baris · batas pembulatan {formatMoney(BigInt(v.threshold), "IDR")}</CardDescription>
          </div>
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Hapus impor ${v.fileName}`} disabled={busy} />}><Trash2 /></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Hapus impor aging {v.fileName}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Baris aging per {v.asOf} ikut terhapus.
                  {v.finding?.status === "OPEN" && ` ${v.finding.label} ditutup dengan catatan "impor dihapus" dan tercatat di riwayat. Bila selisihnya nyata, jelaskan dulu, jangan dihapus.`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Batal</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={remove}>Hapus</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid gap-3 sm:grid-cols-3">
          <div><dt className="eyebrow">Aging klien</dt><dd className="text-lg"><Money value={BigInt(v.aging)} /></dd></div>
          <div>
            <dt className="eyebrow">Buku besar</dt>
            <dd className="text-lg"><Money value={BigInt(v.ledger)} /></dd>
            <dd className="text-xs text-muted-foreground">
              {v.accounts.map((a, i) => <span key={a.code}>{i > 0 && " · "}<Link href={ledgerHref(a.code)} className="drill">{a.code}</Link> {formatMoney(BigInt(a.balance), "IDR")}</span>)}
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Selisih (aging − buku besar)</dt>
            <dd className={diff !== 0n && v.status === "DIFFERENCE" ? "text-lg text-review" : "text-lg"}><Money value={diff} /></dd>
            {v.percent !== null && <dd className="num text-xs text-muted-foreground">{v.percent.toLocaleString("id-ID")}% dari buku besar</dd>}
          </div>
        </dl>

        {v.finding && (
          <div className="rounded-md border px-3 py-3 text-sm" data-testid="recon-finding">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-medium">{v.finding.label}</span>
              <StatusPill status={v.finding.status === "OPEN" ? "REVIEW" : "PASS"} label={v.finding.status === "OPEN" ? "Terbuka" : "Ditutup"} />
            </div>
            {v.finding.status === "OPEN" && v.status !== "DIFFERENCE" && (
              <p className="mt-1 text-pass" data-testid="recon-now-matches">Buku besar sekarang cocok dengan aging ini. Tulis apa yang dikoreksi untuk menutup temuannya.</p>
            )}
            {v.finding.status === "OPEN" ? (
              <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                <Field>
                  <FieldLabel htmlFor={`explain-${v.importId}`}>Penjelasan</FieldLabel>
                  <Textarea id={`explain-${v.importId}`} rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="Mis. faktur 28–31 Des belum masuk aging sistem; uang muka pelanggan di 2160; dikonfirmasi bagian keuangan" />
                  <FieldDescription>Apa penyebabnya dan siapa yang mengonfirmasi (min. {EXPLAIN_MIN} karakter). Bila perlu koreksi, catat dulu di Jurnal Penyesuaian.</FieldDescription>
                </Field>
                <Button variant="outline" className="md:mt-6" disabled={busy || explanation.trim().length < EXPLAIN_MIN} onClick={resolve}>Tutup {v.finding.label}</Button>
              </div>
            ) : (
              <p className="mt-1"><span className="text-muted-foreground">Penjelasan:</span> {v.finding.resolution}</p>
            )}
          </div>
        )}

        {v.status === "DIFFERENCE" && (
          <div className="space-y-4" data-testid="recon-candidates">
            <h3 className="text-sm font-semibold">Kandidat penyebab</h3>
            {c.cutoff.length > 0 && (
              <Section title={`Jurnal sekitar ${v.asOf} (±7 hari) di akun yang dibandingkan`} hint="Faktur atau pelunasan di sekitar tutup periode yang mungkin belum (atau sudah) masuk aging.">
                {c.cutoff.map((x, i) => (
                  <Line key={i} left={<><span className="num text-muted-foreground">{x.date}</span> <Link href={ledgerHref(x.code)} className="drill">{x.code}</Link> {x.memo}{x.source && <span className="text-xs text-muted-foreground"> · {x.source}</span>}</>} amount={x.amount} />
                ))}
              </Section>
            )}
            {(c.credits.length > 0 || c.advances.length > 0) && (
              <Section title="Uang muka dan saldo kredit" hint={v.kind === "RECEIVABLE" ? "Baris aging bersaldo kredit (kelebihan bayar / uang muka) dan akun uang muka pelanggan." : "Baris aging bersaldo debit-balik dan akun uang muka pembelian."}>
                {c.credits.map((x, i) => <Line key={`c${i}`} left={<>{x.counterparty} <span className="text-xs text-muted-foreground">· {x.sourceRef}</span></>} amount={x.total} />)}
                {c.advances.map((a) => <Line key={a.code} left={<><Link href={ledgerHref(a.code)} className="drill">{a.code}</Link> {a.name}</>} amount={a.balance} />)}
              </Section>
            )}
            {c.nonTrade.length > 0 && (
              <Section title={v.kind === "PAYABLE" ? "Utang di luar aging" : "Piutang di luar aging"} hint={v.kind === "PAYABLE" ? "Saldo akun lain yang tidak dibandingkan. Ringkasan aging sering tidak mencakup utang bank, pemegang saham atau akrual." : "Saldo piutang lain yang tidak dibandingkan, mis. piutang karyawan, pihak berelasi atau antar entitas."}>
                {c.nonTrade.map((a) => <Line key={a.code} left={<><Link href={ledgerHref(a.code)} className="drill">{a.code}</Link> {a.name}</>} amount={a.balance} />)}
              </Section>
            )}
            {c.cutoff.length === 0 && c.credits.length === 0 && c.advances.length === 0 && c.nonTrade.length === 0 && (
              <p className="text-sm text-muted-foreground">Tidak ada jurnal di sekitar tanggal itu, saldo kredit, uang muka, atau akun lain bersaldo. Cek faktur yang belum dicatat atau jurnal penyesuaian di laporan klien.</p>
            )}
          </div>
        )}

        {v.counterparties && v.counterparties.length > 0 && (
          <Section title="Per pelanggan / pemasok" hint="Aging klien dibandingkan dengan faktur di Buku per nama.">
            <Table className="text-sm">
              <TableHeader>
                <TableRow><TableHead>Nama</TableHead><TableHead className="text-right">Aging</TableHead><TableHead className="hidden text-right sm:table-cell">Buku</TableHead><TableHead className="text-right">Selisih</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {v.counterparties.map((x, i) => (
                  <TableRow key={i}>
                    <TableCell className="whitespace-normal">{x.name}{x.sourceRef ? <span className="text-xs text-muted-foreground"> · {x.sourceRef}</span> : <span className="text-xs text-review"> · tidak ada di aging</span>}</TableCell>
                    <TableCell className="text-right"><Money value={BigInt(x.aging)} /></TableCell>
                    <TableCell className="hidden text-right sm:table-cell"><Money value={BigInt(x.buku)} /></TableCell>
                    <TableCell className="text-right"><Money value={BigInt(x.difference)} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>
        )}

        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            <ChevronRight className="size-4 transition-transform group-data-[panel-open]:rotate-90" aria-hidden />
            Baris aging ({v.rows.length})
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <Table className="text-sm">
              <TableHeader><TableRow><TableHead>Nama</TableHead><TableHead className="hidden sm:table-cell">Baris</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {v.rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="whitespace-normal">{r.counterparty}{r.rounded && <span className="text-xs text-muted-foreground"> · dibulatkan</span>}</TableCell>
                    <TableCell className="hidden font-mono text-xs sm:table-cell">{r.sourceRef}</TableCell>
                    <TableCell className="text-right"><Money value={BigInt(r.total)} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h4 className="text-sm font-medium">{title}</h4>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="divide-y rounded-md border">{children}</div>
    </section>
  );
}

function Line({ left, amount }: { left: React.ReactNode; amount: string }) {
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-1.5 text-sm">
      <span className="min-w-0 break-words">{left}</span>
      <Money value={BigInt(amount)} className="shrink-0" />
    </div>
  );
}
