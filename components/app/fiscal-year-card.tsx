"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveFiscalYearEndAction } from "@/app/actions";
import { fiscalSpan } from "@/lib/fiscal";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** The client's tahun buku: which months "the year" holds on every report. Saves on change; refused once a month is closed. */
export function FiscalYearCard({ clientId, endMonth, locked }: { clientId: string; endMonth: number; locked: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(endMonth);
  const [busy, setBusy] = useState(false);

  async function change(next: number) {
    const before = value;
    setValue(next);
    setBusy(true);
    const r = await saveFiscalYearEndAction(clientId, next);
    setBusy(false);
    if (!r.ok) {
      setValue(before);
      return void toast.error(r.error);
    }
    toast.success("Tahun buku disimpan");
    router.refresh();
  }

  return (
    <Card data-testid="fiscal-year-card">
      <CardHeader>
        <CardTitle>Tahun buku</CardTitle>
        <CardDescription>Bulan-bulan yang dihitung sebagai satu tahun di Laba Rugi, Neraca, CALK dan daftar aset. Tidak mengubah jurnal.</CardDescription>
      </CardHeader>
      <CardContent>
        <Field>
          <FieldLabel htmlFor="fiscal-year-end">Tahun buku</FieldLabel>
          <Select value={value} onValueChange={(v) => change(v as number)} disabled={busy || locked}>
            <SelectTrigger id="fiscal-year-end" className="w-full sm:w-72" aria-label="Tahun buku"><SelectValue>{fiscalSpan(value)}</SelectValue></SelectTrigger>
            <SelectContent>{MONTHS.map((m) => <SelectItem key={m} value={m}>{fiscalSpan(m)}</SelectItem>)}</SelectContent>
          </Select>
          <FieldDescription>
            {locked ? "Sudah ada bulan yang ditutup, jadi tahun buku tidak bisa diubah. Buka kunci bulannya dulu bila perlu." : value === 12 ? "Tahun kalender." : "Pajak Badan di Buku belum mendukung tahun buku non-kalender."}
          </FieldDescription>
        </Field>
      </CardContent>
    </Card>
  );
}
