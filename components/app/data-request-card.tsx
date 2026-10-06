"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Copy, Send } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

/**
 * Permintaan data ke klien (I1a): the message built from the completeness grid, ready to copy or open in WhatsApp. Nothing is sent by
 * Buku; the accountant picks the contact. Editable before copying, so the firm's own tone stays.
 */
export function DataRequestCard({ message, items }: { message: string; items: number }) {
  const [text, setText] = useState(message);
  const ref = useRef<HTMLTextAreaElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Pesan tersalin");
    } catch {
      ref.current?.select();
      toast.message("Pesan sudah dipilih: tekan Ctrl+C untuk menyalin");
    }
  };
  return (
    <Card data-testid="data-request">
      <CardHeader>
        <CardTitle>Minta data yang kurang ke klien</CardTitle>
        <CardDescription>
          {items} hal masih kurang. Pesan ini dibuat dari tabel kelengkapan; ubah bila perlu, lalu kirim ke kontak klien.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea ref={ref} value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(14, text.split("\n").length + 1)} className="font-mono text-xs" aria-label="Pesan permintaan data" />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={copy}>
            <Copy /> Salin pesan
          </Button>
          <a className={buttonVariants({ variant: "outline" })} href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
            <Send /> Kirim lewat WhatsApp
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
