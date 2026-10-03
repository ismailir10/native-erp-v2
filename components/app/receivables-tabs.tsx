"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Piutang · Utang · Rekonsiliasi: the three views of the receivables page, kept in the URL (`?tab=`). */
export function ReceivablesTabs({ value }: { value: "piutang" | "utang" | "rekonsiliasi" }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <Tabs
      value={value}
      onValueChange={(v) => {
        const p = new URLSearchParams(params.toString());
        p.set("tab", String(v));
        router.push(`${pathname}?${p.toString()}`);
      }}
    >
      <TabsList>
        <TabsTrigger value="piutang">Piutang</TabsTrigger>
        <TabsTrigger value="utang">Utang</TabsTrigger>
        <TabsTrigger value="rekonsiliasi">Rekonsiliasi</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
