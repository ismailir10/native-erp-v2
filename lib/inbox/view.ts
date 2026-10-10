import { bankName } from "@/lib/banks";
import type { BankSection, InboxItem, LedgerSection } from "./check";

/**
 * How the Unggah page words one file's line (cycle 2026-10-10-unggah-inbox). Pure and client-safe: no database, no server imports, so
 * the page's client component and the server code (lib/inbox/plan.ts) say "BCA ·3814" the same way.
 */

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const shortBank = (code: string) => (code === "GENERIC" ? "Bank" : bankName(code).split(" / ")[0]);

/** "BCA ·3814". */
export const accountDisplay = (bank: string, number: string) => `${shortBank(bank)} ·${digits(number).slice(-4)}`;

/** "Jan 2026", "Jan–Mar 2026", "Des 2025–Jan 2026" from ISO days; "" when unknown. */
export function monthSpan(start: string | null, end: string | null): string {
  const parse = (d: string | null) => (d && /^\d{4}-\d{2}/.test(d) ? { y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)) } : null);
  const a = parse(start) ?? parse(end);
  const b = parse(end) ?? a;
  if (!a || !b) return "";
  const month = (p: { m: number }) => MONTHS_SHORT[p.m - 1];
  if (a.y === b.y && a.m === b.m) return `${month(a)} ${a.y}`;
  if (a.y === b.y) return `${month(a)}–${month(b)} ${a.y}`;
  return `${month(a)} ${a.y}–${month(b)} ${b.y}`;
}

/** One statement of a bank file: "BCA ·5566 · Jan 2026" (a number the reader couldn't read: "BNI · Jan 2026"; valas adds its currency). */
export function sectionSummary(s: BankSection): string {
  const account = s.number && digits(s.number) ? accountDisplay(s.bank, s.number) : shortBank(s.bank);
  const currency = s.currency && s.currency !== "IDR" ? ` · ${s.currency}` : "";
  const months = monthSpan(s.periodStart, s.periodEnd);
  return [account + currency, months].filter(Boolean).join(" · ");
}

/** One table of a ledger / Neraca file: "Buku besar · GL · 120 baris · Jan–Des 2025". */
export function ledgerSummary(t: LedgerSection): string {
  const months = monthSpan(t.periodStart, t.periodEnd);
  return [t.mode === "NERACA" ? "Neraca" : "Buku besar", t.sheet, `${t.rows} baris`, months].filter(Boolean).join(" · ");
}

/** What Buku read in the file, while it still waits (a booked or kept file's message already says it). */
export function itemSummary(item: Pick<InboxItem, "kind" | "sections">): string {
  if (item.kind === "BANK") return (item.sections as BankSection[]).map(sectionSummary).join("; ");
  if (item.kind === "LEDGER") return (item.sections as LedgerSection[]).map(ledgerSummary).join("; ");
  return "";
}

export type LineTone = "pass" | "review" | "fail" | "busy" | "muted";

/** The status of a file's line: icon tone + label. Waiting and kept files are neutral; only control states use pass / review / fail. */
export function statusView(status: InboxItem["status"]): { tone: LineTone; label: string } {
  switch (status) {
    case "CHECKED":
      return { tone: "muted", label: "Siap dibukukan" };
    case "PROCESSING":
      return { tone: "busy", label: "Sedang dibukukan" };
    case "NEEDS_PASSWORD":
      return { tone: "review", label: "Perlu kata sandi" };
    case "NEEDS_ACCOUNT":
      return { tone: "review", label: "Perlu rekening" };
    case "BOOKED":
      return { tone: "pass", label: "Dibukukan" };
    case "DRAFT":
      return { tone: "review", label: "Draf" };
    case "KEPT":
      return { tone: "muted", label: "Disimpan di Dokumen" };
    case "FAILED":
      return { tone: "fail", label: "Gagal" };
  }
}

const KEPT_PLAIN = "Disimpan di Dokumen.";

/** The line's message, unless it only repeats the status label ("Disimpan di Dokumen."). */
export function lineMessage(item: Pick<InboxItem, "status" | "message">): string | null {
  if (!item.message) return null;
  if (item.status === "KEPT" && item.message === KEPT_PLAIN) return null;
  return item.message;
}

/**
 * The file needs the single-file path under *Cara lain*: a refusal the manual import can answer (year prompt, *Atur kolom*, sheet
 * choice) or a scan / photo (its *Baca scan dengan AI* offer).
 */
/** Failures another form can't fix: a closed month, foreign currency, a password, the size or storage limit, a lost file. */
const NOT_A_READING_PROBLEM = /ditutup|valas|kata sandi|5 MB|10 MiB|penuh|tidak tersimpan/i;

export function needsManualPath(item: Pick<InboxItem, "status" | "kind" | "message">): boolean {
  if (item.status === "FAILED") return !NOT_A_READING_PROBLEM.test(item.message ?? "");
  return item.status === "KEPT" && item.kind === "OTHER" && /\b(scan|gambar)\b/i.test(item.message ?? "");
}

/** Statuses that still need the page (a password, the card, or processing). */
export const OPEN_STATUSES: InboxItem["status"][] = ["CHECKED", "PROCESSING", "NEEDS_PASSWORD", "NEEDS_ACCOUNT"];

/** "7 file selesai: 5 dibukukan, 1 draf buku besar, 1 disimpan di Dokumen." — the drop's outcome in one sentence. */
export function batchSummary(items: Pick<InboxItem, "status">[]): string {
  const count = (s: InboxItem["status"]) => items.filter((i) => i.status === s).length;
  const parts = [
    [count("BOOKED"), "dibukukan"],
    [count("DRAFT"), "draf buku besar"],
    [count("KEPT"), "disimpan di Dokumen"],
    [count("FAILED"), "gagal"],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, label]) => `${n} ${label}`);
  return `${items.length} file selesai${parts.length ? `: ${parts.join(", ")}` : ""}.`;
}
