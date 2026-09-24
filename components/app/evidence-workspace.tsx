"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { FileText, ChevronRight, AlertCircle, CheckCircle2, Pause, Play, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { NextStep, PageHeader } from "@/components/app/page-header";
import { ClientForm } from "@/components/app/client-form";
import type { Workspace } from "@/lib/evidence/workspace";
import type { EvidenceUnit } from "@/lib/evidence/types";
import type { NewClientInput } from "@/lib/onboarding";
import { createEvidenceAction, beginEvidenceUploadAction, appendEvidenceUploadAction, finishEvidenceUploadAction, processEvidenceAction, loadEvidenceAction, attachDriveAction, includeEvidenceAction, excludeEvidenceAction, confirmEvidenceAction, decideEvidenceFactAction, resolveEvidenceConflictAction, linkEvidenceClientAction, analyzeEvidenceAction, askEvidenceAction, prepareEvidenceImportAction, postEvidenceBankAction, startGoogleAction, disconnectGoogleAction } from "@/app/actions";
import type { EvidenceAnswer } from "@/lib/evidence/answers";

const selectClass = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm";
const roleNames: Record<string, string> = { SOURCE: "Sumber pencatatan", COMPARISON: "Pembanding", CONTEXT: "Konteks" };
const kindNames: Record<string, string> = { BANK: "Rekening koran", LEDGER: "Buku besar", REPORT: "Laporan keuangan", CONTEXT: "Konteks perusahaan", UNKNOWN: "Perlu dikenali" };
const factNames: Record<string, string> = { companyName: "Nama perusahaan", businessActivity: "Kegiatan usaha", industry: "Bidang usaha", legalForm: "Bentuk badan usaha", fiscalYearEnd: "Akhir tahun buku", address: "Alamat", documentKind: "Jenis dokumen", entity: "Entitas", periodStart: "Awal periode", periodEnd: "Akhir periode", currency: "Mata uang" };
const statusNames: Record<string, string> = { READY: "Siap diperiksa", PENDING: "Menunggu proses", ERROR: "Perlu tindakan", MISSING: "Tidak tersedia", DIRECTORY: "Folder", SHORTCUT: "Pintasan", IGNORED: "Dilewati", DONE: "Pemeriksaan selesai", PARTIAL: "Pemeriksaan belum lengkap" };
type Clients = { id: string; name: string }[];

export function EvidenceHome({ intakes, clients, clientId, connected, googleConfigured, googleResult }: { intakes: { id: string; name: string; status: string; clientId: string | null }[]; clients: Clients; clientId?: string; connected: boolean; googleConfigured: boolean; googleResult?: "connected" | "error" }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [passcode, setPasscode] = useState("");
  return <div className="space-y-6">
    <PageHeader title="Dokumen" description="Rekening koran, buku besar, laporan, dan konteks perusahaan dalam satu tempat." />
    <NextStep>Unggah file atau tempel tautan Drive. Periksa hasil sebelum mencatat ke buku.</NextStep>
    {googleResult === "connected" && connected && <p role="status" className="rounded-lg border border-pass/20 bg-pass-subtle p-3 text-sm text-pass">Google berhasil dihubungkan. Tambahkan dokumen lalu tempel tautan folder.</p>}
    {googleResult === "error" && <p role="alert" className="rounded-lg border border-review/30 bg-review-subtle p-3 text-sm">Google belum berhasil dihubungkan. Izin mungkin dibatalkan atau sesi kedaluwarsa. Masukkan kode admin lalu coba hubungkan kembali.</p>}
    <Button disabled={busy} onClick={async () => { setBusy(true); const r = await createEvidenceAction(clientId); setBusy(false); if (r.ok) router.push(`/documents/${r.data.id}`); else toast.error(r.error); }}><Upload className="size-4" /> Tambahkan dokumen</Button>
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card><CardHeader><CardTitle>Kumpulan dokumen</CardTitle></CardHeader><CardContent>
        {!intakes.length ? <p className="text-sm text-muted-foreground">Belum ada dokumen. Klien bisa dibuat setelah file diperiksa.</p> : <ul className="divide-y">{intakes.map(i => <li key={i.id}><Link href={`/documents/${i.id}`} className="flex items-center gap-3 py-4"><FileText className="size-5 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{i.name}</span><span className="text-xs text-muted-foreground">{clients.find(c => c.id === i.clientId)?.name ?? "Belum dihubungkan ke klien"} · {statusNames[i.status] ?? i.status}</span></span><ChevronRight className="size-4" /></Link></li>)}</ul>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Google Drive</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
        <p>{connected ? "Google terhubung. Buku membaca folder yang Anda tambahkan." : "Hubungkan sekali melalui admin, lalu tempel tautan folder."}</p>
        {!googleConfigured && <p className="text-muted-foreground">Admin perlu menyiapkan koneksi Google. Unggah manual tetap tersedia.</p>}
        {(googleConfigured || connected) && <><Field><FieldLabel htmlFor="drive-passcode">Kode admin</FieldLabel><Input id="drive-passcode" type="password" autoComplete="off" value={passcode} onChange={e => setPasscode(e.target.value)} /></Field><div className="flex flex-wrap gap-2">
          {googleConfigured && <Button variant="outline" disabled={busy || !passcode} onClick={async () => { setBusy(true); try { const r = await startGoogleAction(passcode); if (r.ok) window.location.assign(r.url); else toast.error(r.error); } catch { toast.error("Koneksi terputus. Coba hubungkan Google kembali."); } finally { setPasscode(""); setBusy(false); } }}>{connected ? "Hubungkan ulang" : "Hubungkan Google"}</Button>}
          {connected && <Button variant="outline" disabled={busy || !passcode} onClick={async () => { setBusy(true); try { const r = await disconnectGoogleAction(passcode); if (r.ok) { toast.success(r.note ?? "Google diputuskan"); router.replace(clientId ? `/clients/${clientId}/documents` : "/documents"); router.refresh(); } else toast.error(r.error); } catch { toast.error("Koneksi terputus. Coba putuskan Google kembali."); } finally { setPasscode(""); setBusy(false); } }}>Putuskan Google</Button>}
        </div></>}

      </CardContent></Card>
    </div>
  </div>;
}

function proposedClient(workspace: Workspace): NewClientInput {
  const documents = workspace.documents.filter(d => !d.excluded && d.status === "READY");
  const units = documents.flatMap(d => d.versions.filter(v => v.id === d.currentVersionId).flatMap(v => v.units));
  const names = [...new Set(units.map(u => u.entity).filter((v): v is string => Boolean(v)))];
  const currentVersions = new Set(documents.map(d => d.currentVersionId));
  const industry = workspace.facts.filter(f => currentVersions.has(f.versionId) && /industry|businessActivity/i.test(f.key)).sort((a, b) => Number(b.status === "CONFIRMED") - Number(a.status === "CONFIRMED"))[0]?.value ?? "";
  return { name: names[0] ?? "", industry, entities: (names.length ? names : [""]).map(name => {
    const currencies = [...new Set(units.filter(u => u.entity === name).map(u => u.currency).filter((c): c is string => Boolean(c)))];
    return { name, shortName: name, kind: /\b(pte|ltd|limited|llc|inc|llp|plc|gmbh)\b/i.test(name) ? "BADAN_USAHA_ASING" : /^CV\b/i.test(name) ? "CV" : "PT", npwp: "", currency: currencies.length === 1 ? currencies[0] : "", banks: [] };
  }) };
}

export function EvidenceWorkspace({ initial, clients }: { initial: Workspace; clients: Clients }) {
  const [workspace, setWorkspace] = useState(initial); const [busy, setBusy] = useState(false); const [running, setRunning] = useState(false); const [progress, setProgress] = useState("");
  const [url, setUrl] = useState(initial.intake.sourceUrl ?? ""); const [question, setQuestion] = useState(""); const [answer, setAnswer] = useState<EvidenceAnswer | null>(null); const [answerScope, setAnswerScope] = useState(""); const [showClient, setShowClient] = useState(false); const [existingClient, setExistingClient] = useState("");
  const search = useSearchParams(); const router = useRouter(); const entityId = search.get("entity") === "combined" ? "" : search.get("entity") ?? ""; const period = search.get("period") ?? "";
  const stopped = useRef(false); const mounted = useRef(true); const processing = useRef(false); const autoResumed = useRef(false); const uploadInput = useRef<HTMLInputElement>(null); const id = workspace.intake.id;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stopped.current = true; }; }, []);
  const refresh = useCallback(async () => { if (!mounted.current) return; const r = await loadEvidenceAction(id); if (r.ok && mounted.current) setWorkspace(r.data); }, [id]);
  const run = useCallback(async () => {
    if (processing.current || !mounted.current) return; processing.current = true; stopped.current = false; setRunning(true);
    try { while (!stopped.current) { const r = await processEvidenceAction(id); if (!mounted.current) break; if (!r.ok) { toast.error(r.error); break; } await refresh(); if (r.data.error) toast.error(r.data.error); if (!r.data.more) break; if (r.data.busy) { setProgress("Sesi lain sedang memproses. Progres tersimpan."); break; } } }
    catch { if (mounted.current) toast.error("Pemeriksaan terputus. Progres tersimpan; pilih Lanjutkan pemeriksaan."); }
    finally { processing.current = false; if (mounted.current) { setRunning(false); setProgress(""); } }
  }, [id, refresh]);
  useEffect(() => {
    if (autoResumed.current) return;
    if (!initial.intake.hasPendingWork) { autoResumed.current = true; return; }
    const resume = setTimeout(() => { autoResumed.current = true; void run(); }, 0);
    return () => clearTimeout(resume);
  }, [initial.intake.hasPendingWork, run]);
  async function upload(files: FileList | null) {
    if (!files?.length || processing.current) return; setBusy(true); setAnswer(null);
    try {
      for (const file of Array.from(files)) {
        if (!mounted.current) return;
        setProgress(`Mengunggah ${file.name}`);
        const start = await beginEvidenceUploadAction(id, file.name, file.size); if (!start.ok) { toast.error(start.error); continue; }
        let failed = false;
        for (let offset = 0; offset < file.size; offset += 1024 * 1024) { if (!mounted.current) return; const fd = new FormData(); fd.set("chunk", file.slice(offset, offset + 1024 * 1024)); const r = await appendEvidenceUploadAction(start.data.id, offset, fd); if (!r.ok) { toast.error(r.error); failed = true; break; } }
        if (!failed && mounted.current) { const done = await finishEvidenceUploadAction(start.data.id); if (!done.ok) toast.error(done.error); }
      }
      await refresh();
    } catch { if (mounted.current) toast.error("Unggahan terputus. File yang sudah selesai tetap tersimpan; unggah kembali file lainnya."); }
    finally { if (mounted.current) { setBusy(false); setProgress(""); if (uploadInput.current) uploadInput.current.value = ""; } }
    if (mounted.current) void run();
  }
  async function action(fn: () => Promise<{ ok: boolean; error?: string }>) { setBusy(true); try { const r = await fn(); if (!r.ok) toast.error(r.error); else setAnswer(null); await refresh(); } catch { toast.error("Koneksi terputus. Muat ulang untuk memeriksa hasil sebelum mencoba kembali."); } finally { if (mounted.current) setBusy(false); } }
  function scope(nextEntity: string, nextPeriod: string) { setAnswer(null); const p = new URLSearchParams(); if (nextEntity) p.set("entity", nextEntity); if (nextPeriod) p.set("period", nextPeriod); router.replace(`/documents/${id}?${p}`); }
  const pending = workspace.documents.filter(d => !d.excluded && d.status === "PENDING").length;
  const docs = [...workspace.documents].sort((a, b) => Number(a.excluded) - Number(b.excluded) || Number(b.status === "ERROR") - Number(a.status === "ERROR"));
  return <div className="space-y-6">
    <PageHeader title={workspace.intake.name} description="Bukti sumber tersimpan terpisah dari buku. Setiap versi dapat ditelusuri." actions={<Link href={workspace.intake.clientId ? `/clients/${workspace.intake.clientId}/documents` : "/documents"} className="text-sm text-primary">Semua dokumen</Link>} />
    <NextStep>{running ? "File sedang diperiksa. Menutup halaman menjeda proses setelah langkah aktif selesai." : workspace.intake.status === "PARTIAL" ? "Pemeriksaan belum lengkap. Periksa kendala di bawah." : pending ? `${pending} file menunggu. Lanjutkan pemeriksaan dari progres tersimpan.` : "Periksa peran sumber dan perbedaan. Anda sudah bisa bertanya tentang dokumen."}</NextStep>
    {workspace.intake.issue && <p role="alert" className="rounded-md border border-review/30 bg-review-subtle p-3 text-sm">{workspace.intake.issue}</p>}
    <Card><CardHeader><CardTitle>Unggah file atau tempel tautan Drive</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="flex flex-wrap gap-3"><Button disabled={busy || running} onClick={() => uploadInput.current?.click()}><Upload className="size-4" /> Pilih file</Button><input ref={uploadInput} aria-label="File dokumen" type="file" multiple className="sr-only" onChange={e => void upload(e.target.files)} /><span className="self-center text-xs text-muted-foreground">PDF teks, XLSX, CSV, TXT, Markdown · 10 MiB/file</span></div>
      <div className="flex flex-wrap gap-2"><Input aria-label="Tautan folder Drive" placeholder="https://drive.google.com/drive/folders/…" value={url} onChange={e => setUrl(e.target.value)} className="min-w-0 flex-1" /><Button variant="outline" disabled={busy || running || !url} onClick={async () => { setBusy(true); const r = await attachDriveAction(id, url); setBusy(false); if (!r.ok) toast.error(r.error); else { setAnswer(null); await refresh(); void run(); } }}>{workspace.intake.sourceUrl ? "Periksa pembaruan" : "Baca folder"}</Button></div>
      <div className="flex flex-wrap items-center gap-3"><Button size="sm" variant="outline" disabled={busy} onClick={() => { if (running) { stopped.current = true; setProgress("Menunggu langkah aktif selesai; setelah itu proses dijeda."); } else void run(); }}>{running ? <Pause className="size-4" /> : <Play className="size-4" />}{running ? "Jeda setelah langkah ini" : "Lanjutkan pemeriksaan"}</Button><span role="status" className="text-xs text-muted-foreground">{progress || statusNames[workspace.intake.status]}</span></div>
    </CardContent></Card>
    {workspace.conflicts.filter(c => !c.resolved).length > 0 && <Card><CardHeader><CardTitle>Perbedaan sumber</CardTitle></CardHeader><CardContent className="space-y-4">{workspace.conflicts.filter(c => !c.resolved).map(c => <Conflict key={c.id} message={c.message} sources={c.versionIds.map((versionId, index) => ({ versionId, label: workspace.documents.flatMap(d => d.versions).find(v => v.id === versionId)?.name ?? `Sumber ${index + 1}` }))} disabled={busy || running} onResolve={note => action(() => resolveEvidenceConflictAction(id, c.id, note))} />)}</CardContent></Card>}
    {!workspace.intake.clientId && <Card><CardHeader><CardTitle>Hubungkan perusahaan</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">Analisis dokumen tersedia sekarang. Konfirmasi perusahaan sebelum menyiapkan pencatatan.</p><div className="flex flex-wrap gap-2"><select aria-label="Klien yang sudah ada" className={`${selectClass} max-w-xs`} value={existingClient} onChange={e => setExistingClient(e.target.value)}><option value="">Pilih klien yang sudah ada</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><Button variant="outline" disabled={!existingClient || busy || running} onClick={() => void action(() => linkEvidenceClientAction(id, existingClient))}>Hubungkan klien</Button><Button variant="outline" disabled={busy || running} onClick={() => setShowClient(!showClient)}>Periksa usulan klien baru</Button></div>{showClient && <fieldset disabled={busy || running} className="min-w-0"><ClientForm initial={proposedClient(workspace)} evidenceIntakeId={id} onCreated={() => void refresh()} /></fieldset>}</CardContent></Card>}
    <Card><CardHeader><CardTitle>File dan peran sumber</CardTitle></CardHeader><CardContent className="space-y-4">
      {!docs.length && <p className="text-sm text-muted-foreground">Belum ada file. Unggah beberapa dokumen sekaligus atau tambahkan folder.</p>}
      {docs.map(d => <details key={d.id} className="rounded-lg border p-4" open={d.status === "ERROR"}><summary className="flex cursor-pointer items-center gap-3"><FileText className="size-4 shrink-0" /><span className="min-w-0 flex-1"><span className="block break-words font-medium">{d.name}</span><span className="text-xs text-muted-foreground">{d.excluded ? "Tidak disertakan" : statusNames[d.status]} · {d.versions.length} versi</span></span><ChevronRight className="size-4 shrink-0" /></summary>
        <div className="mt-4 space-y-4"><p className="break-all text-xs text-muted-foreground">{d.path}</p>{d.issue && <p role="alert" className="text-sm text-review">{d.issue}</p>}
        <div className="flex flex-wrap gap-2">{d.status !== "IGNORED" && (d.status !== "DIRECTORY" || d.excluded) && <Button size="sm" variant="outline" disabled={busy || running} onClick={() => void action(() => d.excluded || d.status === "ERROR" ? includeEvidenceAction(id, d.id) : excludeEvidenceAction(id, d.id))}>{d.excluded ? "Sertakan" : d.status === "ERROR" ? "Coba kembali" : "Keluarkan dari analisis"}</Button>}
        {d.currentVersionId && !d.excluded && <Button size="sm" variant="outline" disabled={busy || running} onClick={() => void action(async () => { const r = await analyzeEvidenceAction(id, d.currentVersionId!); if (r.ok) toast.message(r.data.note ?? `${r.data.facts} usulan konteks`); return r; })}>Minta usulan konteks AI</Button>}</div>
        {d.versions.map(v => <div key={v.id} className="space-y-3">{v.id !== d.currentVersionId ? <Link href={`/documents/source/${v.id}`} className="text-xs text-primary">Buka versi tersimpan · {v.createdAt.slice(0, 10)}</Link> : <>{v.issues.map((issue, i) => <p key={i} className="text-sm text-review">{issue}</p>)}{v.units.map(unit => <UnitReview key={`${v.id}:${unit.key}:${workspace.intake.clientId ?? "new"}:${unit.entity}:${unit.currency}:${unit.periodStart}:${unit.periodEnd}`} unit={unit} versionId={v.id} workspace={workspace} disabled={busy || running || d.excluded} onRefresh={refresh} />)}</>}</div>)}
        {d.status === "ERROR" && /sandi|password/i.test(d.issue ?? "") && <PasswordRetry intakeId={id} documentId={d.id} refresh={refresh} />}</div>
      </details>)}
    </CardContent></Card>
    {workspace.facts.length > 0 && <Card><CardHeader><CardTitle>Konteks perusahaan</CardTitle></CardHeader><CardContent className="space-y-3">{workspace.facts.map(f => <div key={f.id} className="flex flex-wrap items-start gap-3 border-b pb-3 last:border-0"><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{factNames[f.key] ?? f.key}: {f.value}</p><Link className="text-xs text-primary" href={`/documents/source/${f.versionId}?at=${encodeURIComponent(f.locator)}#cited-source`}>{f.locator}</Link><p className="text-xs text-muted-foreground">{f.status === "CONFIRMED" ? "Dikonfirmasi" : f.status === "CONFLICTING" ? "Bertentangan · perlu diperiksa" : "Usulan · belum dikonfirmasi"}</p></div><Button size="sm" variant="outline" disabled={busy || running || f.status === "CONFIRMED"} onClick={() => void action(() => decideEvidenceFactAction(id, f.id, true))}>Konfirmasi</Button><Button size="sm" variant="ghost" disabled={busy || running} onClick={() => void action(() => decideEvidenceFactAction(id, f.id, false))}>Abaikan</Button></div>)}</CardContent></Card>}
    <Card><CardHeader><CardTitle>Tanyakan dokumen dan buku</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2"><Field><FieldLabel htmlFor="ask-entity">Entitas</FieldLabel><select id="ask-entity" disabled={busy} className={selectClass} value={entityId} onChange={e => scope(e.target.value, period)}><option value="">Semua entitas dalam kumpulan</option>{workspace.entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field><Field><FieldLabel htmlFor="ask-period">Periode (opsional)</FieldLabel><Input id="ask-period" disabled={busy} type="month" value={period} onChange={e => scope(entityId, e.target.value)} /></Field></div>
      <form className="flex gap-2" onSubmit={async e => { e.preventDefault(); if (busy) return; const askedScope = `${entityId}/${period}`; setBusy(true); setAnswer(null); try { const r = await askEvidenceAction(id, question, entityId || undefined, period || undefined); if (r.ok) { if (mounted.current) { setAnswer(r.data); setAnswerScope(askedScope); } await refresh(); } else toast.error(r.error); } catch { toast.error("Jawaban belum dapat dimuat. Periksa koneksi lalu coba kembali."); } finally { if (mounted.current) setBusy(false); } }}><Input aria-label="Pertanyaan" placeholder="Bandingkan laba tahun lalu, atau cari perjanjian pinjaman…" value={question} onChange={e => setQuestion(e.target.value)} maxLength={2000} /><Button type="submit" variant="outline" disabled={busy || !question.trim()}>Tanyakan</Button></form>
      {answer && answerScope === `${entityId}/${period}` && <AnswerView answer={answer} />}
      {workspace.messages.length > 0 && <details><summary className="cursor-pointer text-sm text-muted-foreground">Pertanyaan sebelumnya ({workspace.messages.length})</summary><div className="mt-4 space-y-6">{workspace.messages.map(m => <div key={m.id}><p className="mb-2 text-sm font-medium">{m.question}</p><AnswerView answer={m.answer as unknown as EvidenceAnswer} /></div>)}</div></details>}
    </CardContent></Card>
  </div>;
}

function Conflict({ message, sources, disabled, onResolve }: { message: string; sources: { versionId: string; label: string }[]; disabled: boolean; onResolve: (note: string) => Promise<void> }) {
  const [note, setNote] = useState(""); return <div className="space-y-2 rounded-md bg-review-subtle p-3"><p className="flex gap-2 text-sm"><AlertCircle className="size-4 shrink-0" />{message}</p>{sources.length > 0 && <div className="flex flex-wrap gap-3">{sources.map(source => <Link key={source.versionId} href={`/documents/source/${source.versionId}`} className="break-all text-xs text-primary">{source.label} <ChevronRight className="inline size-3" /></Link>)}</div>}<p className="text-xs text-muted-foreground">Periksa versi sumber, lalu jelaskan pilihan di bawah.</p><Input aria-label="Alasan pemilihan sumber" value={note} onChange={e => setNote(e.target.value)} placeholder="Sumber mana yang digunakan, dan mengapa?" /><Button size="sm" variant="outline" disabled={disabled || note.trim().length < 8} onClick={() => void onResolve(note)}>Simpan hasil pemeriksaan</Button></div>;
}
function PasswordRetry({ intakeId, documentId, refresh }: { intakeId: string; documentId: string; refresh: () => Promise<void> }) {
  const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false); return <div className="flex gap-2"><Input type="password" aria-label="Sandi PDF" value={password} onChange={e => setPassword(e.target.value)} placeholder="Sandi PDF (tidak disimpan)" /><Button variant="outline" disabled={busy || !password} onClick={async () => { setBusy(true); const included = await includeEvidenceAction(intakeId, documentId); if (!included.ok) toast.error(included.error); else { const r = await processEvidenceAction(intakeId, password, documentId); if (!r.ok) toast.error(r.error); else if (r.data.error) toast.error(r.data.error); } setPassword(""); setBusy(false); await refresh(); }}>Buka PDF</Button></div>;
}
function UnitReview({ unit, versionId, workspace, disabled, onRefresh }: { unit: EvidenceUnit; versionId: string; workspace: Workspace; disabled: boolean; onRefresh: () => Promise<void> }) {
  const saved = workspace.selections.find(s => s.versionId === versionId && s.unitKey === unit.key);
  const [role, setRole] = useState(saved?.role ?? unit.role); const [entity, setEntity] = useState(saved?.entityId ?? workspace.entities.find(e => e.name.toLowerCase() === unit.entity?.toLowerCase())?.id ?? "");
  const [from, setFrom] = useState(saved?.periodStart ?? unit.periodStart ?? ""); const [to, setTo] = useState(saved?.periodEnd ?? unit.periodEnd ?? ""); const [currency, setCurrency] = useState(saved?.currency ?? unit.currency ?? ""); const [bank, setBank] = useState(saved?.bankAccountId ?? "");
  const [busy, setBusy] = useState(false); const [bankPreview, setBankPreview] = useState<string | null>(null); const [password, setPassword] = useState("");
  const intakeId = workspace.intake.id;
  const changed = !saved || role !== saved.role || entity !== (saved.entityId ?? "") || from !== (saved.periodStart ?? "") || to !== (saved.periodEnd ?? "") || currency !== (saved.currency ?? "") || bank !== (saved.bankAccountId ?? "");
  return <div className="space-y-3 rounded-md border bg-background p-3"><div className="flex flex-wrap items-center gap-2"><Link className="min-w-0 break-words text-sm font-medium text-primary" href={`/documents/source/${versionId}?at=${encodeURIComponent(unit.passages[0]?.locator ?? "")}`}>{unit.label} <ChevronRight className="inline size-3" /></Link><span className="text-xs text-muted-foreground">{kindNames[unit.kind]}{saved?.confirmed ? changed ? " · Pilihan berubah; konfirmasi kembali" : " · Peran dikonfirmasi" : " · Usulan"}</span></div>{unit.issues.map((s,i) => <p key={i} className="text-xs text-review">{s}</p>)}
    <fieldset disabled={disabled || busy || Boolean(saved?.importId)} onChangeCapture={() => setBankPreview(null)} className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3"><Field><FieldLabel>Peran</FieldLabel><select aria-label={`Peran ${unit.label}`} className={selectClass} value={role} onChange={e => setRole(e.target.value)}>{Object.entries(roleNames).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></Field><Field><FieldLabel>Entitas</FieldLabel><select aria-label={`Entitas ${unit.label}`} className={selectClass} value={entity} onChange={e => { setEntity(e.target.value); setBank(""); }}><option value="">{unit.entity ?? "Pilih entitas"}</option>{workspace.entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field><Field><FieldLabel>Mata uang</FieldLabel><Input aria-label={`Mata uang ${unit.label}`} value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} maxLength={3} placeholder="IDR / SGD / USD" /></Field><Field><FieldLabel>Dari</FieldLabel><Input aria-label={`Dari ${unit.label}`} type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field><Field><FieldLabel>Sampai</FieldLabel><Input aria-label={`Sampai ${unit.label}`} type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>{unit.kind === "BANK" && <Field><FieldLabel>Rekening</FieldLabel><select aria-label={`Rekening ${unit.label}`} className={selectClass} value={bank} onChange={e => setBank(e.target.value)}><option value="">Pilih rekening</option>{workspace.entities.find(e => e.id === entity)?.bankAccounts.map(b => <option key={b.id} value={b.id}>{b.label} · {b.number.slice(-4)}</option>)}</select></Field>}</fieldset>
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={disabled || busy || Boolean(saved?.importId)} onClick={async () => { setBusy(true); const r = await confirmEvidenceAction(intakeId, versionId, unit.key, { role, entityId: entity || undefined, periodStart: from || undefined, periodEnd: to || undefined, currency: currency || undefined, bankAccountId: bank || undefined }); if (!r.ok) toast.error(r.error); else { toast.success("Peran sumber dikonfirmasi"); setBankPreview(null); await onRefresh(); } setBusy(false); }}><CheckCircle2 className="size-3" />Konfirmasi peran</Button>
      {saved?.confirmed && saved.role === "SOURCE" && !saved.importId && <Button size="sm" variant="outline" disabled={disabled || busy || changed} onClick={async () => { setBusy(true); const r = await prepareEvidenceImportAction(intakeId, versionId, unit.key, bank || undefined, password || undefined); if (!r.ok) toast.error(r.error); else if (r.data.importId) { await onRefresh(); toast.success("Draf impor siap diperiksa"); } else setBankPreview(`${r.data.rows} transaksi · ${r.data.continuityOk ? "saldo nyambung" : "saldo perlu diperiksa"}`); setBusy(false); }}>Siapkan impor</Button>}
      {saved?.importId && workspace.intake.clientId && <Link className="self-center text-sm text-primary" href={unit.kind === "BANK" ? `/clients/${workspace.intake.clientId}/review` : `/clients/${workspace.intake.clientId}/import/ledger/${saved.importId}`}>Buka hasil impor <ChevronRight className="inline size-3" /></Link>}
    </div>
    {unit.kind === "BANK" && saved?.confirmed && !saved.importId && <Input type="password" aria-label={`Sandi impor ${unit.label}`} placeholder="Sandi PDF bila diperlukan (tidak disimpan)" value={password} onChange={e => setPassword(e.target.value)} />}
    {bankPreview && !changed && <div className="space-y-2 rounded border p-3"><p className="text-sm">{bankPreview}. Pencatatan mengikuti pemeriksaan dan aturan Buku. Transaksi belum pasti masuk antrean review.</p><Button size="sm" variant="outline" disabled={disabled || busy} onClick={async () => { setBusy(true); const r = await postEvidenceBankAction(intakeId, versionId, unit.key, bank, password || undefined); if (!r.ok) toast.error(r.error); else { toast.success("Mutasi dicatat"); setBankPreview(null); setPassword(""); await onRefresh(); } setBusy(false); }}>Konfirmasi dan catat mutasi</Button></div>}
  </div>;
}
function AnswerView({ answer }: { answer: EvidenceAnswer }) {
  return <div className="space-y-3 rounded-lg border bg-background p-4"><p className="text-sm">{answer.text}</p>{answer.rows?.length ? <div className="divide-y">{answer.rows.map((r,i) => <div className="grid gap-1 py-2 text-sm sm:grid-cols-[1fr_2fr]" key={i}><span className="min-w-0 break-words font-medium">{r.label}</span><span className="min-w-0 whitespace-pre-wrap break-words num">{r.value}</span></div>)}</div> : null}<div className="flex flex-wrap gap-3">{answer.citations.map((c,i) => <Link key={i} className="break-all text-xs text-primary" href={`/documents/source/${c.versionId}?at=${encodeURIComponent(c.locator)}#cited-source`}>{c.label} · {c.locator}</Link>)}{answer.links?.map((l,i) => <Link key={i} className="text-xs text-primary" href={l.href}>{l.label}</Link>)}</div>{answer.limitations.map((l,i) => <p key={i} className="text-xs text-muted-foreground">{l}</p>)}</div>;
}
