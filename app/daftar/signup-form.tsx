"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SimpleSelect } from "@/components/app/simple-select";
import { submitSignupAction } from "./actions";

/** Name, work email, organisation and its kind; phone and a note are optional. `website` is a honeypot people never see. */
export function SignupForm() {
  const [form, setForm] = useState({ name: "", email: "", orgName: "", orgKind: "KANTOR_AKUNTAN", phone: "", note: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const message = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error || done) message.current?.focus(); }, [error, done]);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: e.target.value });
  if (done) return <p ref={message} tabIndex={-1} role="status" className="rounded-xl bg-pass-subtle px-4 py-3 text-sm text-pass" data-testid="signup-done">{done}</p>;
  return (
    <form className="space-y-4" data-testid="signup-form" aria-busy={busy} aria-describedby={error ? "signup-error" : undefined} onSubmit={async (e) => {
      e.preventDefault();
      if (busy) return;
      setBusy(true); setError(null);
      try {
        const r = await submitSignupAction(form);
        if (r.ok) setDone(r.notice); else setError(r.error);
      } catch {
        setError("Permintaan belum berhasil dikirim. Coba lagi.");
      } finally {
        setBusy(false);
      }
    }}>
      <div className="space-y-1"><label htmlFor="signup-name" className="text-sm">Nama Anda</label><Input id="signup-name" value={form.name} onChange={set("name")} autoComplete="name" required /></div>
      <div className="space-y-1"><label htmlFor="signup-email" className="text-sm">Email kerja</label><Input id="signup-email" type="email" value={form.email} onChange={set("email")} autoComplete="email" required /></div>
      <div className="space-y-1"><label htmlFor="signup-kind" className="text-sm">Jenis</label><SimpleSelect id="signup-kind" label="Jenis" value={form.orgKind} onChange={(v) => setForm({ ...form, orgKind: v })} options={[{ value: "KANTOR_AKUNTAN", label: "Kantor akuntan (mengerjakan buku klien)" }, { value: "PERUSAHAAN", label: "Perusahaan (mengerjakan buku sendiri)" }]} /></div>
      <div className="space-y-1"><label htmlFor="signup-org" className="text-sm">{form.orgKind === "PERUSAHAAN" ? "Nama perusahaan" : "Nama kantor"}</label><Input id="signup-org" value={form.orgName} onChange={set("orgName")} autoComplete="organization" required /></div>
      <div className="space-y-1"><label htmlFor="signup-phone" className="text-sm">Nomor WhatsApp (opsional)</label><Input id="signup-phone" type="tel" value={form.phone} onChange={set("phone")} autoComplete="tel" /></div>
      <div className="space-y-1"><label htmlFor="signup-note" className="text-sm">Catatan (opsional)</label><Textarea id="signup-note" value={form.note} onChange={set("note")} rows={3} placeholder={form.orgKind === "PERUSAHAAN" ? "Contoh: 3 entitas, bank BCA dan Mandiri" : "Contoh: 40 klien, kebanyakan rekening BCA"} /></div>
      <div aria-hidden className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden"><label htmlFor="signup-website">Situs web</label><input id="signup-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} /></div>
      {error && <p ref={message} id="signup-error" tabIndex={-1} role="alert" className="text-sm text-fail">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy} aria-describedby="signup-consent">{busy && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />}{busy ? "Mengirim permintaan…" : "Minta akses uji coba"}</Button>
      <p id="signup-consent" className="text-xs leading-relaxed text-muted-foreground">Dengan mengirim, Anda menyetujui <Link href="/syarat" className="drill">Syarat</Link> dan mengizinkan Buku memproses data untuk meninjau serta menghubungi Anda tentang permintaan uji coba, sesuai <Link href="/kebijakan-privasi" className="drill">Privasi</Link>.</p>
    </form>
  );
}
