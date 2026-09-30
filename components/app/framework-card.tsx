"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveReportingFrameworkAction } from "@/app/actions";
import { FRAMEWORK_OPTIONS, type Framework } from "@/lib/reports/framework";

/** One selector per entity: which standard its CALK and statements name. Saves on change; it moves no figure. */
export function FrameworkCard({ clientId, entities }: { clientId: string; entities: { id: string; name: string; framework: Framework }[] }) {
  const router = useRouter();
  const [values, setValues] = useState(() => Object.fromEntries(entities.map((e) => [e.id, e.framework])) as Record<string, Framework>);
  const [busy, setBusy] = useState<string | null>(null);

  async function change(id: string, next: Framework) {
    const before = values[id];
    setValues((v) => ({ ...v, [id]: next }));
    setBusy(id);
    const r = await saveReportingFrameworkAction(clientId, id, next);
    setBusy(null);
    if (!r.ok) {
      setValues((v) => ({ ...v, [id]: before }));
      return void toast.error(r.error);
    }
    toast.success("Kerangka pelaporan disimpan");
    router.refresh();
  }

  return (
    <Card data-testid="framework-card">
      <CardHeader>
        <CardTitle>Kerangka pelaporan</CardTitle>
        <CardDescription>Menentukan standar yang disebut di CALK, nama laporan dan penanda tangan surat pernyataan. Angka laporan tidak berubah.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {entities.map((e) => {
          const current = FRAMEWORK_OPTIONS.find((o) => o.value === values[e.id]);
          return (
            <Field key={e.id}>
              <FieldLabel>{e.name}</FieldLabel>
              <Select value={values[e.id]} onValueChange={(v) => change(e.id, v as Framework)} disabled={busy === e.id}>
                <SelectTrigger className="w-full sm:w-64" aria-label={`Kerangka pelaporan ${e.name}`}><SelectValue>{current?.label}</SelectValue></SelectTrigger>
                <SelectContent>{FRAMEWORK_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
              <FieldDescription>{current?.help}</FieldDescription>
            </Field>
          );
        })}
      </CardContent>
    </Card>
  );
}
