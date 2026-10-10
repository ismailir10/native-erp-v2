"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { approveSignupAction, rejectSignupAction } from "@/app/backoffice-actions";
import { wibDatePlus } from "@/components/backoffice/org-forms";

/** Approve with a trial end date (14 days by default) or reject with a reason. */
export function RequestActions({ requestId, email }: { requestId: string; email: string }) {
  const router = useRouter();
  const [endsOn, setEndsOn] = useState(wibDatePlus(14));
  const [mode, setMode] = useState<"approve" | "reject">("approve");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(work: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    setBusy(true);
    const r = await work();
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(done);
    router.refresh();
  }
  if (mode === "reject") return (
    <div className="flex flex-wrap items-end gap-2">
      <Input aria-label="Alasan menolak" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Alasan" className="w-56" />
      <Button size="sm" variant="destructive" disabled={busy || reason.trim().length < 5} onClick={() => act(() => rejectSignupAction(requestId, reason), "Permintaan ditolak")}>Tolak</Button>
      <Button size="sm" variant="ghost" onClick={() => setMode("approve")}>Batal</Button>
    </div>
  );
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1"><label htmlFor={`ends-${requestId}`} className="block text-xs text-muted-foreground">Uji coba sampai</label><Input id={`ends-${requestId}`} type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className="w-40" /></div>
      <Button size="sm" variant="ghost" onClick={() => setEndsOn(wibDatePlus(14))}>14 hari</Button>
      <Button size="sm" variant="ghost" onClick={() => setEndsOn(wibDatePlus(30))}>30 hari</Button>
      <Button size="sm" disabled={busy || !endsOn} onClick={() => act(() => approveSignupAction(requestId, endsOn), `Disetujui; undangan terkirim ke ${email}`)}>{busy && <Loader2 className="animate-spin" />}Setujui</Button>
      <Button size="sm" variant="outline" onClick={() => setMode("reject")}>Tolak</Button>
    </div>
  );
}
