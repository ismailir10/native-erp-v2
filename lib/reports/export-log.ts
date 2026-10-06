import type { Db } from "@/lib/db";
import { recordEvent } from "@/lib/audit";
import { getCurrentMember } from "@/lib/tenant";
import { formatPeriod } from "@/lib/format";

/**
 * A report that left Buku (ADR 0014: the close is measured to the first report sent after the lock). One `REPORT_EXPORT` event per
 * download, subject `period:YYYY-MM`. Logging never blocks the download: a failure is reported to the server log only.
 */
export async function recordExport(
  db: Db,
  e: { clientId: string; entityId?: string | null; scope: string; year: number; month: number; file: "Laporan keuangan (Excel)" | "Laporan keuangan (PDF)" | "Kertas kerja PPh Badan" | "Paket kredit bank" | "Laporan manajemen"; final: boolean },
) {
  try {
    const member = await getCurrentMember().catch(() => null);
    await recordEvent(db, {
      clientId: e.clientId,
      entityId: e.entityId ?? null,
      kind: "REPORT_EXPORT",
      subject: `period:${e.year}-${String(e.month).padStart(2, "0")}`,
      summary: `${e.file} · ${e.scope} · ${formatPeriod(e.year, e.month)} · ${e.final ? "final" : "draf"}`,
      after: { file: e.file, scope: e.scope, final: e.final },
      actorId: member?.id ?? null,
    });
  } catch (err) {
    console.error("recordExport", err);
  }
}
