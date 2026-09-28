"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/app/status";
import { closeReviewAction } from "@/app/actions";
import type { CloseReviewView } from "@/lib/controls/ai-review";

/** ADR 0009: AI explains flagged controls and proposes an action. It never posts, acks or locks. */
export function CloseReviewCard({ clientId, year, month, flagged, aiReady, initial }: { clientId: string; year: number; month: number; flagged: number; aiReady: boolean; initial: CloseReviewView | null }) {
  const [review, setReview] = useState<CloseReviewView | null>(initial);
  const [busy, setBusy] = useState(false);
  const items = [...(review?.items ?? [])].sort((a, b) => Number(a.status === "REVIEW") - Number(b.status === "REVIEW"));
  return (
    <Card data-testid="close-review">
      <CardHeader>
        <CardTitle>Tinjauan AI</CardTitle>
        <CardDescription>
          {aiReady
            ? `${flagged} kontrol ditandai. AI menjelaskan kemungkinan penyebabnya dan mengusulkan tindakan dari baris yang dikutip. Anda yang memutuskan: AI tidak mencatat jurnal, memberi catatan, atau menutup buku.`
            : "AI belum diatur di Pengaturan. Kontrol tetap berjalan; periksa yang ditandai secara manual."}
        </CardDescription>
      </CardHeader>
      {aiReady && (
        <CardContent className="space-y-4">
          {items.length > 0 && (
            <ul className="space-y-4">
              {items.map((i) => (
                <li key={i.controlKey} className="space-y-1.5 border-t pt-4 first:border-t-0 first:pt-0" data-testid="close-review-item">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <StatusPill status={i.status} />
                    <span>{i.title}</span>
                    <span className="font-normal text-muted-foreground">{i.scope}</span>
                  </div>
                  <p className="text-sm">{i.explanation}</p>
                  {i.suggestion && (
                    <p className="text-sm">
                      <span className="font-medium">Usulan AI:</span> {i.suggestion}
                    </p>
                  )}
                  {i.links.length > 0 && (
                    <ul className="space-y-0.5 text-xs">
                      {i.links.map((l) => (
                        <li key={l.id}>
                          <Link href={l.href} className="text-muted-foreground underline decoration-border underline-offset-4 hover:text-primary hover:decoration-primary">
                            {l.label} ›
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          {review && items.length === 0 && <p className="text-sm text-muted-foreground">AI tidak memberi penjelasan untuk kontrol yang ditandai. Periksa secara manual.</p>}
          {/* A review is cached per exact input: re-asking before the books change would return the same answer. */}
          {review ? (
            <p className="text-xs text-muted-foreground">Tinjauan ini berlaku untuk kondisi buku saat ini. Setelah Anda memperbaiki sesuatu, tinjau lagi dari sini.</p>
          ) : (
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const res = await closeReviewAction(clientId, year, month);
                setBusy(false);
                if (!res.ok) return toast.error(res.error);
                setReview(res.review);
              }}
            >
              {busy ? "Meninjau… (bisa sampai 1 menit)" : "Tinjau dengan AI"}
            </Button>
          )}
        </CardContent>
      )}
    </Card>
  );
}
