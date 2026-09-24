"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { acceptCheckAction, discardLedgerDraftAction, postLedgerImportAction } from "@/app/actions";

export function AcceptCheckButton({ clientId, checkId }: { clientId: string; checkId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await acceptCheckAction(clientId, checkId);
        setBusy(false);
        if (!r.ok) return toast.error(r.error);
        toast.success("Selisih akan dicatat ke 1999 Belum Terklasifikasi");
        router.refresh();
      }}
    >
      {busy && <Loader2 className="animate-spin" />} Terima & catat selisih ke 1999
    </Button>
  );
}

export function PostImportButton({ clientId, importId, label, disabled }: { clientId: string; importId: string; label: string; disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      disabled={disabled || busy}
      onClick={async () => {
        setBusy(true);
        const r = await postLedgerImportAction(clientId, importId);
        setBusy(false);
        if (!r.ok) return toast.error(r.error);
        toast.success(`${r.entries} jurnal dicatat`);
        router.refresh();
      }}
    >
      {busy && <Loader2 className="animate-spin" />} {label}
    </Button>
  );
}

export function DiscardDraftButton({ clientId, importId }: { clientId: string; importId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await discardLedgerDraftAction(clientId, importId);
        setBusy(false);
        if (!r.ok) return toast.error(r.error);
        toast.success("Draf dibatalkan");
        router.push(`/clients/${clientId}/import?tab=ledger`);
      }}
    >
      Batalkan draf
    </Button>
  );
}
