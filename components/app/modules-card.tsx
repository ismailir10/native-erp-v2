"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { saveClientModulesAction } from "@/app/actions";

type Module = { key: string; label: string; description: string };

/**
 * Modul penyesuaian (ADR 0014 §2): which subledger and PSAK modules this client's menu shows. A module with data stays shown, so its
 * box is ticked and fixed. Saves on change; pages stay reachable by URL either way.
 */
export function ModulesCard({ clientId, modules, enabled, inUse, defaults }: { clientId: string; modules: Module[]; enabled: string[]; inUse: string[]; defaults: string[] }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);

  async function toggle(key: string, checked: boolean) {
    const next = checked ? [...on, key] : on.filter((k) => k !== key);
    const before = on;
    setOn(next);
    setBusy(true);
    const r = await saveClientModulesAction(clientId, next);
    setBusy(false);
    if (!r.ok) {
      setOn(before);
      return void toast.error(r.error);
    }
    toast.success("Menu klien diperbarui");
    router.refresh();
  }

  return (
    <Card data-testid="modules-card">
      <CardHeader>
        <CardTitle>Modul penyesuaian</CardTitle>
        <CardDescription>Modul yang tampil di menu Buku Besar klien ini. Modul yang sudah berisi data selalu tampil. Angkanya tetap masuk laporan dan kontrol.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {modules.map((m) => {
          const used = inUse.includes(m.key);
          const byDefault = !used && defaults.includes(m.key) && !on.includes(m.key);
          const id = `module-${m.key}`;
          return (
            <div key={m.key} className="flex items-start gap-3">
              <Checkbox id={id} checked={used || byDefault || on.includes(m.key)} disabled={busy || used || byDefault} onCheckedChange={(c) => toggle(m.key, c === true)} className="mt-0.5" />
              <div className="min-w-0">
                <label htmlFor={id} className="text-sm font-medium">{m.label}</label>
                <p className="text-xs text-muted-foreground">
                  {m.description}
                  {used ? " Sudah dipakai." : byDefault ? " Tampil karena bidang usahanya perdagangan." : ""}
                </p>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
