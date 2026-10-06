"use client";

import { useRef, useState } from "react";
import { CircleAlert, CircleCheck, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The client's side of a tautan unggah (I1d): pick files, each goes up in 1 MiB parts; only this session's files are listed. */
const CHUNK = 1024 * 1024;
type Item = { name: string; state: "busy" | "done" | "error"; message?: string; progress: number };

export function LinkUploader({ token }: { token: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<Item>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function call(step: string, init: RequestInit, params: Record<string, string> = {}) {
    const q = new URLSearchParams({ step, ...params });
    const res = await fetch(`/kirim/${token}/upload?${q}`, { method: "POST", cache: "no-store", referrerPolicy: "no-referrer", ...init });
    const body = (await res.json().catch(() => ({}))) as { error?: string; id?: string; name?: string };
    if (!res.ok) throw new Error(body.error ?? "Unggahan gagal. Coba lagi.");
    return body;
  }

  async function send(files: File[]) {
    setBusy(true);
    const start = items.length;
    setItems((xs) => [...xs, ...files.map((f) => ({ name: f.name, state: "busy" as const, progress: 0 }))]);
    for (const [k, file] of files.entries()) {
      const i = start + k;
      try {
        const { id } = await call("begin", { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, size: file.size }) });
        for (let offset = 0; offset < file.size; offset += CHUNK) {
          const part = file.slice(offset, offset + CHUNK);
          await call("append", { headers: { "Content-Type": "application/octet-stream" }, body: part }, { id: id!, offset: String(offset) });
          set(i, { progress: Math.min(100, Math.round(((offset + part.size) / file.size) * 100)) });
        }
        await call("finish", {}, { id: id! });
        set(i, { state: "done", progress: 100 });
      } catch (e) {
        set(i, { state: "error", message: e instanceof Error ? e.message : "Unggahan gagal." });
      }
    }
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <input
        ref={input}
        type="file"
        multiple
        accept=".pdf,.csv,.xls,.xlsx"
        className="sr-only"
        data-testid="link-file"
        aria-label="Pilih file"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void send(files);
        }}
      />
      <Button className="w-full" disabled={busy} onClick={() => input.current?.click()}>
        <Upload /> {busy ? "Mengunggah…" : "Pilih file untuk dikirim"}
      </Button>
      <p className="text-xs text-muted-foreground">PDF, CSV, XLS atau XLSX, maksimal 10 MiB per file. Rekening koran PDF yang dikunci sandi akan dibuka oleh kantor akuntan.</p>
      {items.length > 0 && (
        <ul className="divide-y rounded-md border text-sm" data-testid="link-received">
          {items.map((x, i) => (
            <li key={i} className="flex items-start gap-2 px-3 py-2">
              {x.state === "done" ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-pass" aria-hidden /> : x.state === "error" ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-fail" aria-hidden /> : <span className="num mt-0.5 w-8 shrink-0 text-xs text-muted-foreground">{x.progress}%</span>}
              <div className="min-w-0 flex-1">
                <div className="truncate">{x.name}</div>
                <div className="text-xs text-muted-foreground">{x.state === "done" ? "Terkirim" : x.state === "error" ? x.message : "Mengunggah"}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
