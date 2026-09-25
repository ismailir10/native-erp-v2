"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/app/money";
import { revaluationAction } from "@/app/actions";
import { formatRateId } from "@/lib/fx/currency";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Line = { code: string; name: string; currency: string; fxBalance: string; carried: string; target: string; diff: string; rate: string };
type Proposal = { entityId: string; entityName: string; functional: string; lines: Line[]; missingRates: string[] };

/** Proposed month-end revaluation per entity; nothing posts until the accountant clicks. */
export function RevaluationCard({ clientId, year, month, periodLabel, proposals, locked }: { clientId: string; year: number; month: number; periodLabel: string; proposals: Proposal[]; locked: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Revaluasi kurs {periodLabel}</CardTitle>
        <CardDescription>Saldo aset & liabilitas valas dinilai ulang dengan kurs penutup. Selisihnya dicatat ke 7200 Laba/Rugi Selisih Kurs setelah Anda klik.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {proposals.map((p) => (
          <div key={p.entityId} className="space-y-2">
            <div className="text-sm font-medium">{p.entityName} · buku dalam {p.functional}</div>
            {p.missingRates.length > 0 && <p className="text-sm text-review">Isi dulu {p.missingRates.join(", ")} di halaman Kurs.</p>}
            {p.lines.length === 0 && p.missingRates.length === 0 && <p className="text-sm text-muted-foreground">Tidak ada selisih: saldo valas sudah dinilai dengan kurs penutup.</p>}
            {p.lines.length > 0 && (
              <>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="p-2 pl-3 text-left font-medium">Akun</TableHead>
                        <TableHead className="p-2 text-right font-medium">Saldo valas</TableHead>
                        <TableHead className="hidden p-2 text-right font-medium md:table-cell">Tercatat</TableHead>
                        <TableHead className="hidden p-2 text-right font-medium md:table-cell">Dengan kurs penutup</TableHead>
                        <TableHead className="p-2 pr-3 text-right font-medium">Selisih</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {p.lines.map((l) => (
                        <TableRow key={`${l.code}-${l.currency}`} className="border-t">
                          <TableCell className="p-2 pl-3"><span className="num text-muted-foreground">{l.code}</span> {l.name}</TableCell>
                          <TableCell className="p-2 text-right"><Money value={BigInt(l.fxBalance)} currency={l.currency} /> <span className="text-xs text-muted-foreground">@ {formatRateId(l.rate)}</span></TableCell>
                          <TableCell className="hidden p-2 text-right md:table-cell"><Money value={BigInt(l.carried)} currency={p.functional} /></TableCell>
                          <TableCell className="hidden p-2 text-right md:table-cell"><Money value={BigInt(l.target)} currency={p.functional} /></TableCell>
                          <TableCell className="p-2 pr-3 text-right font-medium"><Money value={BigInt(l.diff)} currency={p.functional} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <Button
                  variant="outline"
                  disabled={locked || busy !== null || p.missingRates.length > 0}
                  onClick={async () => {
                    setBusy(p.entityId);
                    const res = await revaluationAction(clientId, p.entityId, year, month);
                    setBusy(null);
                    if (!res.ok) return toast.error(res.error);
                    toast.success(`Revaluasi kurs ${p.entityName} dicatat`);
                    router.refresh();
                  }}
                >
                  {busy === p.entityId ? "Mencatat…" : `Catat revaluasi ${p.entityName}`}
                </Button>
              </>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
