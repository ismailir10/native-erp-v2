"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/app/simple-select";
import { startSupportAction } from "@/app/support-actions";

/** Open an organisation's workspace read-only as one of its members, with a reason (ADR 0017 §2). */
export function SupportForm({ firmId, members }: { firmId: string; members: { id: string; label: string }[] }) {
  const router = useRouter();
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!members.length) return <p className="text-sm text-muted-foreground">Belum ada anggota untuk dilihat.</p>;
  return (
    <div className="space-y-3" data-testid="support-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><label htmlFor="support-member" className="text-sm">Lihat sebagai</label><SimpleSelect id="support-member" label="Lihat sebagai" value={memberId} onChange={setMemberId} options={members.map((m) => ({ value: m.id, label: m.label }))} /></div>
        <div className="space-y-1"><label htmlFor="support-reason" className="text-sm">Alasan</label><Input id="support-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Contoh: Neraca Agustus tidak seimbang, tiket #123" /></div>
      </div>
      <Button disabled={busy || !memberId || reason.trim().length < 10} onClick={async () => {
        setBusy(true);
        const r = await startSupportAction(firmId, memberId, reason);
        setBusy(false);
        if (!r.ok) return void toast.error(r.error);
        router.push("/");
      }}>{busy ? <Loader2 className="animate-spin" /> : <Eye />}Buka ruang kerja</Button>
    </div>
  );
}
