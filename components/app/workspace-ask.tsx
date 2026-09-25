"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { ArrowUp, History, LoaderCircle } from "lucide-react";
import { askWorkspaceAction } from "@/app/workspace-actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Answer = {
  id: string;
  question: string;
  scope: { key: string; label: string; period: string; periodLabel: string };
  text: string;
  rows: { label: string; value: string; source: string }[];
  citations: { label: string; href: string }[];
  limitations: string[];
};
const HistoryContext = createContext<{ answers: Answer[]; addAnswer: (answer: Answer) => void } | null>(null);

/** Memory only: navigation keeps answers; logout or reload discards them. */
export function WorkspaceHistoryProvider({ children }: { children: ReactNode }) {
  const [answers, setAnswers] = useState<Answer[]>([]);
  return <HistoryContext.Provider value={{ answers, addAnswer: (answer) => setAnswers((previous) => [answer, ...previous].slice(0, 20)) }}>{children}</HistoryContext.Provider>;
}

function AnswerCard({ answer }: { answer: Answer }) {
  return (
    <article className="space-y-4 rounded-lg border bg-background p-4" aria-label={`Jawaban: ${answer.question}`}>
      <div><p className="text-xs text-muted-foreground">{answer.scope.label} · {answer.scope.periodLabel}</p><h3 className="mt-1 font-semibold">{answer.question}</h3></div>
      <p className="whitespace-pre-line text-sm leading-relaxed">{answer.text}</p>
      {answer.rows.length > 0 && <dl className="divide-y rounded-lg border bg-card px-3">{answer.rows.map((row, index) => <div key={index} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-3 text-sm"><dt className="min-w-0 flex-1">{row.label}<span className="mt-0.5 block text-xs text-muted-foreground">{row.source.startsWith("/") ? "Dihitung dari buku dan kontrol Buku" : row.source}</span></dt><dd className="num max-w-full break-words text-right font-medium">{row.value}</dd></div>)}</dl>}
      {answer.citations.length > 0 && <div className="space-y-2"><h4 className="text-xs font-semibold text-muted-foreground">Periksa sumber</h4><ul className="space-y-2">{answer.citations.map((citation, index) => <li key={`${citation.href}-${index}`}><Link href={citation.href} className="text-sm text-primary underline underline-offset-4">[{index + 1}] {citation.label}</Link></li>)}</ul></div>}
      {answer.limitations.length > 0 && <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">{answer.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>}
    </article>
  );
}

export function WorkspaceAsk({ scope }: { scope: Answer["scope"] }) {
  const history = useContext(HistoryContext);
  if (!history) throw new Error("WorkspaceAsk requires WorkspaceHistoryProvider");
  const { answers, addAnswer } = history;
  const params = useSearchParams();
  const requestedAnswer = params.get("answer");
  const [selection, setSelection] = useState<{ id: string; requestedAnswer: string | null } | null>(null);
  const selectedId = selection?.requestedAnswer === requestedAnswer ? selection.id : requestedAnswer;
  const selectedAnswer = answers.find((answer) => answer.id === selectedId) ?? answers[0];
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  async function submit() {
    if (busy || !question.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await askWorkspaceAction({ scope: scope.key, period: scope.period, question: question.trim() });
      if (!result.ok) setError(result.error);
      else {
        addAnswer(result.answer);
        setQuestion("");
        setSelection({ id: result.answer.id, requestedAnswer });
      }
    } catch { setError("Jawaban belum berhasil dimuat. Coba kirim pertanyaan lagi."); }
    finally { setBusy(false); }
  }
  return (
    <Card className="border-primary/20">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3"><div><CardTitle role="heading" aria-level={2} className="text-lg">Tanya Buku</CardTitle><p className="mt-1 text-sm text-muted-foreground">{scope.label} · {scope.periodLabel}</p></div><Button type="button" variant="ghost" onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory} aria-controls="workspace-answer-history"><History aria-hidden />Riwayat ({answers.length})</Button></CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="space-y-3">
          <label htmlFor="workspace-question" className="block text-sm font-medium">Apa yang ingin Anda periksa?</label>
          <Textarea ref={inputRef} id="workspace-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Contoh: Klien mana yang belum siap tutup buku?" maxLength={2000} aria-describedby="workspace-ask-help" aria-invalid={Boolean(error)} rows={2} />
          <div className="flex flex-wrap items-center justify-between gap-3"><p id="workspace-ask-help" className="max-w-md text-xs text-muted-foreground">Jawaban menyertakan sumber. Usulan akuntansi tetap perlu diperiksa.</p><Button type="submit" disabled={busy || !question.trim()}>{busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <ArrowUp aria-hidden />}{busy ? "Memeriksa…" : "Tanya Buku"}</Button></div>
          {error && <p role="alert" className="text-sm text-fail">{error}</p>}
        </form>
        <div className="flex flex-wrap gap-2" aria-label="Contoh pertanyaan">{["Apa yang menghambat tutup buku?", "Berapa laba tiap perusahaan?", "Dokumen apa yang tersedia?"].map((example) => <Button key={example} type="button" size="sm" variant="outline" className="h-auto min-h-8 whitespace-normal text-left" onClick={() => { setQuestion(example); inputRef.current?.focus(); }}>{example}</Button>)}</div>
        {requestedAnswer && !answers.some((answer) => answer.id === requestedAnswer) && <p className="text-sm text-muted-foreground">Jawaban ini tidak lagi tersimpan dalam sesi. Kirim pertanyaannya kembali.</p>}
        <div aria-live="polite" aria-atomic="false">{selectedAnswer && <AnswerCard answer={selectedAnswer} />}</div>
        <section id="workspace-answer-history" hidden={!showHistory} className="space-y-3"><h3 className="text-sm font-semibold">Riwayat sesi ini</h3><p className="text-xs text-muted-foreground">Setiap jawaban tetap memakai klien dan periode saat pertanyaan dikirim. Riwayat hilang saat keluar atau memuat ulang.</p>{answers.length <= 1 ? <p className="text-sm text-muted-foreground">Belum ada jawaban sebelumnya.</p> : answers.filter((answer) => answer.id !== selectedAnswer?.id).map((answer) => <details key={answer.id} className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{answer.question}<span className="mt-1 block text-xs font-normal text-muted-foreground">{answer.scope.label} · {answer.scope.periodLabel}</span></summary><div className="mt-3"><AnswerCard answer={answer} /></div></details>)}</section>
      </CardContent>
    </Card>
  );
}
