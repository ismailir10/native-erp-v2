"use client";
import { useState } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { PageHeader, NextStep } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { answerPublicEvidence, demoSourceAnchor, type DemoEvidenceSource, type DemoEvidenceAnswer } from "@/lib/demo/evidence-answers";

const PRIVATE_WORKSPACE = "https://native-erp-v2-git-real-data-ismails-projects-196d40d3.vercel.app/documents";
const QUESTIONS = ["Bandingkan pendapatan", "Apa profil perusahaan?", "Bukti apa yang kurang?"];
const ROLES = { SOURCE: "Sumber pencatatan", COMPARISON: "Pembanding", CONTEXT: "Konteks" };

export function PublicEvidenceDemo({ sources }: { sources: DemoEvidenceSource[] }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<DemoEvidenceAnswer | null>(null);
  function ask(value: string) { setQuestion(value); setAnswer(answerPublicEvidence(sources, value)); }
  return <div className="space-y-6">
    <PageHeader title="Dokumen" description="Demo publik · perusahaan dan angka rekaan" actions={<Button variant="outline" render={<Link href={PRIVATE_WORKSPACE} />}>Buka ruang kerja privat</Button>} />
    <NextStep>Pilih pertanyaan contoh, lalu buka kutipannya untuk memeriksa sumber.</NextStep>
    <Card><CardHeader><CardTitle>Unggah file atau tempel tautan Drive</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
      <p>Di demo publik ini, tiga dokumen contoh sudah disiapkan. Unggahan pribadi dan koneksi Google tersedia di ruang kerja privat setelah masuk.</p>
      <p className="text-muted-foreground">Jangan masukkan data klien ke demo publik. Pertanyaan contoh diproses di peramban tanpa panggilan AI.</p>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Tanyakan tentang dokumen</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Citra Ternak Holdings Pte. Ltd. · USD · tahun berakhir 31 Januari 2023 dan 2024</p>
      <div className="flex flex-wrap gap-2">{QUESTIONS.map(q => <Button key={q} size="sm" variant="outline" onClick={() => ask(q)}>{q}</Button>)}</div>
      <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); ask(question); }}>
        <Input aria-label="Pertanyaan dokumen contoh" placeholder="Contoh: bandingkan laba bersih" maxLength={2000} value={question} onChange={e => setQuestion(e.target.value)} className="min-w-0 flex-1" />
        <Button type="submit" disabled={!question.trim()}>Tanyakan</Button>
      </form>
      {answer && <section aria-live="polite" aria-label="Jawaban dokumen contoh" className="space-y-3 rounded-lg border p-4">
        <p className="text-sm font-medium">{answer.text}</p>
        {answer.rows.map((r,i) => <div key={i} className="flex flex-wrap justify-between gap-2 border-b pb-2 text-sm"><span className="text-muted-foreground">{r.label}</span><span className="num min-w-0 break-words">{r.value}</span></div>)}
        <div className="flex flex-wrap gap-x-4 gap-y-2">{answer.citations.map(c => <a key={c.href} href={c.href} className="break-words text-xs text-primary underline underline-offset-4">{c.label}</a>)}</div>
        <p className="text-xs text-muted-foreground">{answer.limitation}</p>
      </section>}
    </CardContent></Card>
    <section aria-label="Dokumen contoh" className="space-y-4">
      <h2 className="font-semibold">Bukti sumber · 3 dokumen contoh</h2>
      {sources.map(s => <Card key={s.id}><CardHeader><CardTitle className="flex items-center gap-2"><FileText className="size-4 shrink-0" />{s.name}</CardTitle><p className="break-all text-xs text-muted-foreground">Versi contoh tetap · {s.id} · {s.hash.slice(0,12)}</p></CardHeader><CardContent className="space-y-4">
        {s.units.map(u => <div key={u.key} className="space-y-3"><p className="text-sm font-medium">{ROLES[u.role]} · {u.entity ?? "Entitas belum diketahui"} · {u.currency ?? "Mata uang belum diketahui"}{u.periodEnd ? ` · ${u.periodStart ?? "…"}–${u.periodEnd}` : ""}</p>
          {u.passages.map(p => <div id={demoSourceAnchor(s.id,p.locator)} key={p.locator} className="scroll-mt-6 rounded-md border-b p-2 target:border target:border-primary target:bg-primary-subtle"><span className="text-xs text-muted-foreground">{p.locator}</span><p className="whitespace-pre-wrap break-words text-sm">{p.text}</p></div>)}
        </div>)}
      </CardContent></Card>)}
    </section>
  </div>;
}
