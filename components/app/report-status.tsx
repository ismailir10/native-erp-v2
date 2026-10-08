import Link from "next/link";
import { CircleCheck, FilePenLine } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { withParams } from "@/lib/scope";
import { reasonText, type ReportReason, type ReportStatus } from "@/lib/reports/status";

/**
 * Final or draft, above the statements: a closed month says who closed it; an open one says what still makes it a draft, each reason linking
 * to the page that fixes it. The green balance pills below only say the statements add up, not that the books are done.
 */
const ucfirst = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function ReportStatusBar({ status, base, q }: { status: ReportStatus; base: string; q: { period: string; entity: string } }) {
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
    r.kind === "findings" ? `${withParams(`${base}/close`, { period: q.period })}#temuan`
    : r.kind === "review" ? withParams(`${base}/review`, q)
    : r.kind === "suspense" ? withParams(`${base}/ledger/1999`, q)
    : r.kind === "statements" ? `${base}/import`
    : r.kind === "schedules" ? withParams(`${base}/journals/new`, { period: q.period })
    : r.kind === "unmapped" ? withParams(`${base}/ledger/${r.accounts[0].split(" ")[0]}`, q)
    : withParams(`${base}/inventory`, q);
  const head = (
    <p className="flex items-center gap-2">
      <FilePenLine className="size-4 shrink-0 text-review" aria-hidden />
      <span className="font-semibold text-review">Draf</span>
      <span className="text-muted-foreground">· belum final, bulan belum ditutup.</span>
    </p>
  );
  return (
    <div className="rounded-lg border border-l-4 border-l-review bg-card px-4 py-3 text-sm" data-testid="report-status" data-state="draft">
      {head}
      {status.reasons.length ? (
        <ul className="mt-1.5 space-y-1 pl-6">
          {status.reasons.map((r) => (
            <li key={r.kind}><Link href={href(r)} className="drill">{ucfirst(reasonText(r))}</Link></li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 pl-6">
          Pemeriksaan buku lolos. <Link href={withParams(`${base}/close`, { period: q.period })} className="drill">Tutup buku</Link> untuk menjadikannya final.
        </p>
      )}
    </div>
  );
}
