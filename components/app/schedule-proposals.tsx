"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/app/money";
import { postAllDueAction, postInstallmentAction } from "@/app/actions";
import type { ProposalView } from "@/lib/adjust/view";

/** The period's due schedule installments; each posts only when the accountant clicks (accounting-rules 5a). */
export function ScheduleProposals({ clientId, year, month, periodLabel, items, locked }: { clientId: string; year: number; month: number; periodLabel: string; items: ProposalView[]; locked: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (!r.ok) return void toast.error((r as { error: string }).error);
    toast.success(done);
    router.refresh();
  };
  return (
    <Card data-testid="schedule-proposals">
      <CardHeader>
        <CardTitle>Jurnal terjadwal {periodLabel}</CardTitle>
        <CardDescription>Angsuran bulan ini dari jadwal penyusutan, amortisasi dan akrual. Dicatat ke buku besar setelah Anda klik.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="divide-y rounded-lg border">
          {items.map((p) => {
            const key = `${p.scheduleId}:${p.k}`;
            return (
              <div key={key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="text-sm font-medium">{p.memo}</div>
                  <div className="text-xs text-muted-foreground">{p.entity} · {p.date} · <span className="num">{p.debit} / {p.credit}</span></div>
                </div>
                <Money className="text-sm" value={BigInt(p.amount)} currency={p.currency} />
                <Button variant="outline" size="sm" disabled={locked || busy !== null} onClick={() => run(key, () => postInstallmentAction(clientId, p.scheduleId, p.k), `${p.memo} dicatat`)}>
                  {busy === key ? "Mencatat…" : "Catat"}
                </Button>
              </div>
            );
          })}
        </div>
        {items.length > 1 && (
          <Button variant="outline" disabled={locked || busy !== null} onClick={() => run("all", () => postAllDueAction(clientId, year, month), `${items.length} jurnal terjadwal dicatat`)}>
            {busy === "all" ? "Mencatat…" : `Catat semua (${items.length})`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
