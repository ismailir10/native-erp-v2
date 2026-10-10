import { Clock } from "lucide-react";
import { readOnlyMessage, type Access } from "@/lib/access/grant";
import { formatDateWib } from "@/lib/format";

/** Shown above every workspace page: when access ends within 7 days, and after it ended (read-only). Otherwise nothing. */
export function AccessBanner({ access }: { access: Access }) {
  let text: string | null = null;
  if (access.state === "READ_ONLY") text = readOnlyMessage(access);
  else if (access.state === "ACTIVE" && access.endsAt && access.daysLeft !== null && access.daysLeft <= 7) {
    const what = access.kind === "TRIAL" ? "Uji coba" : "Akses";
    const when = access.daysLeft === 0 ? "hari ini" : `dalam ${access.daysLeft} hari`;
    text = `${what} berakhir ${when} (${formatDateWib(access.endsAt)}). Setelah itu ruang kerja hanya bisa dibaca; data tetap tersimpan.`;
  }
  if (!text) return null;
  return (
    <div role="status" data-testid="access-banner" className="mb-6 flex items-start gap-3 rounded-xl border bg-card px-4 py-3 text-sm">
      <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1">{text}</p>
    </div>
  );
}
