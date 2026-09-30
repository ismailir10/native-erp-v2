import Link from "next/link";
import { CircleCheck, FilePenLine } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { withParams } from "@/lib/scope";
import { reasonText, type ReportReason, type ReportStatus } from "@/lib/reports/status";

/**
 * Final or draft, above the statements: a closed month says who closed it; an open one says what still makes it a draft, each reason linking
 * to the page that fixes it. The green balance pills below only say the statements add up, not that the books are done.
 */
export function ReportStatusBar({ status, base, q, currency }: { status: ReportStatus; base: string; q: { period: string; entity: string }; currency: string }) {
  if (status.locked) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-pass/20 bg-pass-subtle px-4 py-2.5 text-sm text-pass" data-testid="report-status" data-state="final">
        <CircleCheck className="size-4" aria-hidden />
        <span className="font-semibold">Final</span>
        <span>· bulan ini sudah ditutup{status.locked.by ? ` oleh ${status.locked.by}` : ""}{status.locked.at ? `, ${formatDateTime(status.locked.at)}` : ""}</span>
      </div>
    );
  }
  const href = (r: ReportReason) =>
    r.kind === "review" ? withParams(`${base}/review`, q)
    : r.kind === "suspense" ? withParams(`${base}/ledger/1999`, q)
    : r.kind === "statements" ? `${base}/import`
    : r.kind === "schedules" ? withParams(`${base}/journals/new`, { period: q.period })
    : withParams(`${base}/inventory`, q);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-review/40 bg-review-subtle px-4 py-2.5 text-sm" data-testid="report-status" data-state="draft">
      <FilePenLine className="size-4 text-review" aria-hidden />
      <span className="font-semibold text-review">Draf</span>
      <span className="text-muted-foreground">·</span>
      {status.reasons.length ? (
        <>
          <span>belum final:</span>
          {status.reasons.map((r, i) => (
            <span key={r.kind}>
              <Link href={href(r)} className="font-medium underline decoration-review/50 underline-offset-4 hover:text-primary">{reasonText(r, (v) => formatMoney(v, currency))}</Link>
              {i < status.reasons.length - 1 ? ";" : ""}
            </span>
          ))}
          <span className="text-muted-foreground">· bulan belum ditutup.</span>
        </>
      ) : (
        <span>
          pemeriksaan buku lolos; <Link href={withParams(`${base}/close`, { period: q.period })} className="font-medium underline underline-offset-4 hover:text-primary">tutup buku</Link> untuk menjadikannya final.
        </span>
      )}
    </div>
  );
}
