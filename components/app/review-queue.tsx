"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, CheckCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AccountPicker } from "@/components/app/account-picker";
import { MethodBadge } from "@/components/app/status";
import { acceptSimilarAction, reviewAction, suggestAgainAction } from "@/app/actions";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export type ReviewItem = {
  id: string;
  date: string;
  entity: string;
  bank: string;
  description: string;
  amount: string; // bigint as string (client boundary)
  currency: string;
  method: string;
  confidence: number;
  reason: string;
  suggestedCode: string | null;
  taxTag: string | null;
  similar: number;
};
export type AccountOption = { code: string; name: string; group: string };
type Choice = { code: string; tax: string; rule: boolean };

const TAX = [
  { value: "none", label: "Tanpa pajak" },
  { value: "PPN_KELUARAN", label: "PPN Keluaran (pisah 11%)" },
  { value: "PPN_MASUKAN", label: "PPN Masukan (pisah 11%)" },
  { value: "PPH_21", label: "PPh 21" },
  { value: "PPH_23", label: "PPh 23" },
  { value: "PPH_4_2", label: "PPh 4(2)" },
  { value: "PPH_25", label: "PPh 25" },
];

/**
 * Unsaved choices per bank line id, kept in sessionStorage: they survive refreshes, remounts and a reload of the tab, so a
 * correction is never lost before *Simpan*. A tiny external store (useSyncExternalStore) so every card reads the same value.
 */
const DRAFTS = "buku:review-drafts";
let memoryDrafts = "{}"; // private mode: no sessionStorage
const listeners = new Set<() => void>();
const snapshot = () => {
  try {
    return sessionStorage.getItem(DRAFTS) ?? "{}";
  } catch {
    return memoryDrafts;
  }
};
const readDrafts = (): Record<string, Choice> => JSON.parse(snapshot());
const writeDrafts = (d: Record<string, Choice>) => {
  const json = JSON.stringify(d);
  try {
    if (Object.keys(d).length) sessionStorage.setItem(DRAFTS, json);
    else sessionStorage.removeItem(DRAFTS);
  } catch {
    memoryDrafts = json;
  }
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function ReviewQueue({
  items,
  accounts,
  scope,
  clientId,
  simpleGuesses = 0,
}: {
  items: ReviewItem[];
  accounts: AccountOption[];
  scope: { entityIds: string[]; period: string };
  clientId?: string;
  /** Lines in scope that only have the simple guess (the AI gave none at import): offer to ask again. */
  simpleGuesses?: number;
}) {
  const router = useRouter();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [active, setActive] = useState(0);
  const draftsJson = useSyncExternalStore(subscribe, snapshot, () => "{}");
  const choice = useMemo<Record<string, Choice>>(() => JSON.parse(draftsJson), [draftsJson]);
  // Only the bulk "serupa" action blocks the queue; single accepts are optimistic (the card leaves at once, saves run in order).
  const [busy, setBusy] = useState<string | null>(null);
  const inFlight = useRef(0);
  // Saves run one after another in acceptance order: the last decision on a merchant key is the one Memory keeps.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [saving, setSaving] = useState(0);
  const visible = useMemo(() => items.filter((i) => !done.has(i.id)), [items, done]);
  const nameOf = (code: string | null) => accounts.find((a) => a.code === code)?.name ?? "—";

  const suggestion = (i: ReviewItem): Choice => ({ code: i.suggestedCode ?? "", tax: i.taxTag ?? "none", rule: false });
  const get = (i: ReviewItem) => choice[i.id] ?? suggestion(i);
  const isChanged = (i: ReviewItem, c: Choice) => c.code !== (i.suggestedCode ?? "") || c.tax !== (i.taxTag ?? "none");
  const unsaved = (i: ReviewItem) => !!choice[i.id] && (isChanged(i, choice[i.id]) || choice[i.id].rule);

  const set = (i: ReviewItem, patch: Partial<Choice>) => {
    const all = readDrafts();
    writeDrafts({ ...all, [i.id]: { ...(all[i.id] ?? suggestion(i)), ...patch } });
  };
  const clearDraft = (id: string) => {
    const all = readDrafts();
    delete all[id];
    writeDrafts(all);
  };

  // Leaving the tab with an unsaved correction or a save still running asks first (drafts are kept either way).
  const hasUnsaved = visible.some(unsaved) || saving > 0;
  useEffect(() => {
    if (!hasUnsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsaved]);

  const settle = useCallback(() => {
    inFlight.current -= 1;
    setSaving(inFlight.current);
    if (inFlight.current === 0) router.refresh();
  }, [router]);

  const accept = (i: ReviewItem) => {
    const c = get(i);
    if (!c.code) return void toast.error("Pilih akun dulu");
    // Optimistic: the next card is active at once, so Enter keeps working while this one saves.
    setDone((d) => new Set(d).add(i.id));
    setActive((a) => Math.max(0, Math.min(a, visible.length - 2)));
    inFlight.current += 1;
    setSaving(inFlight.current);
    const save = () => reviewAction({ bankTxId: i.id, accountCode: c.code, taxTag: c.tax === "none" ? null : (c.tax as never), createRule: c.rule }).then((r) => {
      if (!r.ok) {
        setDone((d) => {
          const n = new Set(d);
          n.delete(i.id);
          return n;
        });
        toast.error(r.error);
      } else {
        clearDraft(i.id);
        toast.success(`${c.code} ${nameOf(c.code)}`, { description: c.rule ? "Aturan baru dibuat" : "Buku Besar diperbarui · pilihan ini dipakai lagi di impor berikutnya" });
      }
      settle();
    });
    queue.current = queue.current.then(save, save);
  };

  const acceptSimilar = async (i: ReviewItem) => {
    const c = get(i);
    if (!c.code) return void toast.error("Pilih akun dulu");
    setBusy(i.id);
    const override = isChanged(i, c) ? { accountCode: c.code, taxTag: c.tax === "none" ? null : (c.tax as never) } : undefined;
    const r = await acceptSimilarAction(i.id, scope, override);
    setBusy(null);
    if (!r.ok) return void toast.error(r.error);
    for (const id of r.ids) clearDraft(id);
    setDone((d) => new Set([...d, ...r.ids]));
    toast.success(`${r.ids.length} transaksi serupa dicatat ke ${c.code} ${nameOf(c.code)}`);
    router.refresh();
  };

  const [asking, setAsking] = useState(false);
  const askAi = async () => {
    if (!clientId) return;
    setAsking(true);
    const r = await suggestAgainAction(clientId, scope);
    setAsking(false);
    if (!r.ok) return void toast.error(r.error);
    if (r.updated > 0) toast.success(`${r.updated} dari ${r.rows} transaksi mendapat usulan AI`, { description: r.note });
    else toast.error(r.note ?? "AI belum memberi usulan untuk transaksi ini. Pilih akunnya langsung.");
    router.refresh();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("input, textarea, [role=combobox], [role=listbox], [role=dialog]")) return;
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); setActive((a) => Math.min(a + 1, visible.length - 1)); }
      if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
      if (e.key === "Enter" && visible[active] && busy === null) { e.preventDefault(); accept(visible[active]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const savingNote = saving > 0 && (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" data-testid="review-saving">
      <Loader2 className="size-3 animate-spin" /> Menyimpan {saving}…
    </span>
  );

  if (visible.length === 0) {
    return (
      <div className="rounded-lg border bg-card px-6 py-12 text-center">
        <CheckCheck className="mx-auto size-8 text-pass" />
        <div className="mt-2 font-medium">Antrean kosong</div>
        <p className="text-sm text-muted-foreground">Tidak ada transaksi menunggu review dalam cakupan ini.</p>
        {savingNote && <div className="mt-2">{savingNote}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="num font-medium text-foreground" data-testid="review-count">{visible.length} menunggu</span>
        <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> pindah</span>
        <span><Kbd>Enter</Kbd> terima usulan</span>
        {savingNote}
      </div>
      {simpleGuesses > 0 && clientId && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-review/40 bg-review-subtle px-4 py-3 text-sm" data-testid="simple-guesses">
          <span>{simpleGuesses} transaksi hanya punya tebakan sederhana karena AI tidak memberi saran saat impor.</span>
          <Button variant="outline" size="sm" disabled={asking} onClick={askAi}>
            {asking && <Loader2 className="animate-spin" />} Minta saran AI untuk {simpleGuesses} transaksi
          </Button>
        </div>
      )}
      <ul className="space-y-2" data-testid="review-list">
        {visible.map((i, idx) => {
          const c = get(i);
          const amt = BigInt(i.amount);
          const changed = isChanged(i, c);
          return (
            <li
              key={i.id}
              onClick={() => setActive(idx)}
              data-testid="review-item"
              className={cn("rounded-lg border bg-card p-4", idx === active && "ring-2 ring-primary/40")}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{i.date}</span>·<span>{i.entity}</span>·<span>{i.bank}</span>
                  </div>
                  <div className="mt-1 break-words font-mono text-sm">{i.description}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">{amt > 0n ? "Uang masuk" : "Uang keluar"}</div>
                  <div className="num text-lg font-semibold">{formatMoney(amt < 0n ? -amt : amt, i.currency)}</div>
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
                <AccountPicker value={c.code} onChange={(v) => set(i, { code: v })} options={accounts} ariaLabel="Akun" className="w-80 max-w-full" />
                <Select modal={false} value={c.tax} onValueChange={(v) => set(i, { tax: v as string })}>
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
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {unsaved(i) && <span className="text-xs font-medium text-review" data-testid="unsaved">Belum disimpan</span>}
                  {i.similar > 1 && (
                    <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => acceptSimilar(i)}>
                      {busy === i.id && <Loader2 className="animate-spin" />}
                      {changed ? `Simpan untuk ${i.similar} serupa` : `Terima ${i.similar} serupa`}
                    </Button>
                  )}
                  <Button size="sm" variant={idx === active ? "default" : "outline"} disabled={busy !== null} onClick={() => accept(i)} data-testid="accept">
                    <Check /> {changed ? "Simpan" : "Terima"}
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
