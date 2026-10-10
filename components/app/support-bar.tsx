"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Eye, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { endSupportAction, logSupportViewAction } from "@/app/support-actions";

/**
 * Only a Buku admin in a support session sees this (ADR 0017 §2): whose workspace, as whom, minutes left, and the way out. Every page
 * opened is logged on Buku's side. The organisation's members never see a trace of it.
 */
export function SupportBar({ firmName, memberName, expiresAt }: { firmName: string; memberName: string; expiresAt: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 60_000)));
  const [busy, setBusy] = useState(false);
  const path = `${pathname}${search.toString() ? `?${search}` : ""}`;

  useEffect(() => { void logSupportViewAction(path); }, [path]);
  useEffect(() => {
    const tick = () => {
      const minutes = Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 60_000));
      setLeft(minutes);
      if (minutes === 0) router.refresh();
    };
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [expiresAt, router]);

  return (
    <div role="status" data-testid="support-bar" className="sticky top-0 z-40 flex flex-wrap items-center gap-x-3 gap-y-1 bg-foreground px-4 py-2 text-sm text-background md:px-8">
      <Eye className="size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1"><span className="font-semibold">Mode dukungan</span> · {firmName} · sebagai {memberName} · hanya baca · sisa {left} menit</p>
      <Button size="sm" variant="outline" disabled={busy} className="text-foreground" onClick={async () => {
        setBusy(true);
        const r = await endSupportAction();
        setBusy(false);
        if (!r.ok) return void toast.error(r.error);
        router.push(r.firmId ? `/backoffice/orgs/${r.firmId}` : "/backoffice");
      }}><LogOut />Keluar</Button>
    </div>
  );
}
