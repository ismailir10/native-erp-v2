"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, CheckCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MethodBadge } from "@/components/app/status";
import { acceptSimilarAction, reviewAction } from "@/app/actions";
import { formatRupiah } from "@/lib/money";
import { cn } from "@/lib/utils";

export type ReviewItem = {
  id: string;
  date: string;
  entity: string;
  bank: string;
  description: string;
  amount: string; // bigint as string (client boundary)
  method: string;
  confidence: number;
  reason: string;
  suggestedCode: string | null;
  taxTag: string | null;
  similar: number;
};
export type AccountOption = { code: string; name: string; group: string };

const TAX = [
  { value: "none", label: "Tanpa pajak" },
  { value: "PPN_KELUARAN", label: "PPN Keluaran (pisah 11%)" },
  { value: "PPN_MASUKAN", label: "PPN Masukan (pisah 11%)" },
  { value: "PPH_21", label: "PPh 21" },
  { value: "PPH_23", label: "PPh 23" },
  { value: "PPH_4_2", label: "PPh 4(2)" },
  { value: "PPH_25", label: "PPh 25" },
];

export function ReviewQueue({ items, accounts, scope }: { items: ReviewItem[]; accounts: AccountOption[]; scope: { entityIds: string[]; period: string } }) {
  const router = useRouter();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [active, setActive] = useState(0);
  const [choice, setChoice] = useState<Record<string, { code: string; tax: string; rule: boolean }>>({});
  // Explicit busy flag (not useTransition): the post-save refresh must not block the next Enter.
  const [busy, setBusy] = useState<string | null>(null);
  const pending = busy !== null;
  const visible = useMemo(() => items.filter((i) => !done.has(i.id)), [items, done]);
  const groups = [...new Set(accounts.map((a) => a.group))];
  const nameOf = (code: string | null) => accounts.find((a) => a.code === code)?.name ?? "—";

  const get = (i: ReviewItem) => choice[i.id] ?? { code: i.suggestedCode ?? "", tax: i.taxTag ?? "none", rule: false };
  const set = (i: ReviewItem, patch: Partial<{ code: string; tax: string; rule: boolean }>) => setChoice((c) => ({ ...c, [i.id]: { ...get(i), ...patch } }));

  const accept = async (i: ReviewItem) => {
    const c = get(i);
    if (!c.code) return void toast.error("Pilih akun dulu");
    setBusy(i.id);
    const r = await reviewAction({ bankTxId: i.id, accountCode: c.code, taxTag: c.tax === "none" ? null : (c.tax as never), createRule: c.rule });
    setBusy(null);
    if (!r.ok) return void toast.error(r.error);
    setDone((d) => new Set(d).add(i.id));
    setActive((a) => Math.max(0, Math.min(a, visible.length - 2)));
    toast.success(`${c.code} ${nameOf(c.code)}`, { description: c.rule ? "Aturan baru dibuat" : "Buku Besar diperbarui · Buku akan ingat pilihan ini" });
    router.refresh();
  };

  const acceptSimilar = async (i: ReviewItem) => {
    setBusy(i.id);
    const r = await acceptSimilarAction(i.id, scope);
    setBusy(null);
    if (!r.ok) return void toast.error(r.error);
    toast.success(`${r.count} transaksi serupa diterima`);
    router.refresh();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.getAttribute("role") === "combobox") return;
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); setActive((a) => Math.min(a + 1, visible.length - 1)); }
      if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
      if (e.key === "Enter" && visible[active] && !pending) { e.preventDefault(); accept(visible[active]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (visible.length === 0) {
    return (
      <div className="rounded-lg border bg-card px-6 py-12 text-center">
        <CheckCheck className="mx-auto size-8 text-pass" />
        <div className="mt-2 font-medium">Antrean kosong</div>
        <p className="text-sm text-muted-foreground">Tidak ada transaksi menunggu review dalam cakupan ini.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> pindah</span>
        <span><Kbd>Enter</Kbd> terima usulan</span>
      </div>
      <ul className="space-y-2" data-testid="review-list">
        {visible.map((i, idx) => {
          const c = get(i);
          const amt = BigInt(i.amount);
          const changed = c.code !== i.suggestedCode;
          return (
            <li
              key={i.id}
              onClick={() => setActive(idx)}
              data-testid="review-item"
              className={cn("rounded-lg border bg-card p-4 shadow-xs transition-shadow", idx === active && "ring-2 ring-primary/40")}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{i.date}</span>·<span>{i.entity}</span>·<span>{i.bank}</span>
                  </div>
                  <div className="mt-1 break-words font-mono text-sm">{i.description}</div>
                </div>
                <div className={cn("num text-right text-lg font-semibold", amt > 0n ? "text-pass" : "text-foreground")}>
                  {amt > 0n ? "+" : "−"}{formatRupiah(amt < 0n ? -amt : amt)}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <MethodBadge method={i.method} />
                <span>{i.reason.replace(/^AI: /, "")}</span>
                {i.method === "AI" && (
                  <span className={cn("num text-xs", i.confidence < 0.7 && "font-medium text-review")}>
                    · {i.confidence < 0.7 ? "keyakinan rendah, cek lagi" : "keyakinan"} {Math.round(i.confidence * 100)}%
                  </span>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                <Select value={c.code} onValueChange={(v) => set(i, { code: v as string })}>
                  <SelectTrigger className="w-80 max-w-full" aria-label="Akun">
                    <SelectValue placeholder="Pilih akun" />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => (
                      <SelectGroup key={g}>
                        <SelectLabel>{g}</SelectLabel>
                        {accounts.filter((a) => a.group === g).map((a) => (
                          <SelectItem key={a.code} value={a.code}>{a.code} {a.name}</SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={c.tax} onValueChange={(v) => set(i, { tax: v as string })}>
                  <SelectTrigger className="w-56" aria-label="Pajak">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TAX.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox id={`rule-${i.id}`} checked={c.rule} onCheckedChange={(v) => set(i, { rule: Boolean(v) })} />
                  <label htmlFor={`rule-${i.id}`} className="cursor-pointer">Selalu gunakan akun ini</label>
                </div>
                <div className="ml-auto flex gap-2">
                  {i.similar > 1 && !changed && (
                    <Button variant="outline" size="sm" disabled={pending} onClick={() => acceptSimilar(i)}>Terima {i.similar} serupa</Button>
                  )}
                  <Button size="sm" disabled={pending} onClick={() => accept(i)} data-testid="accept">
                    {busy === i.id ? <Loader2 className="animate-spin" /> : <Check />} {changed ? "Simpan" : "Terima"}
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
