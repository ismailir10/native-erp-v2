import type { Db } from "@/lib/db";
import { recordEvent } from "@/lib/audit";
import { FormatError, lineLabel, STATEMENT_LINES, validateFormat, type ReportFormat, type StatementKey } from "@/lib/reports/format";

/**
 * Saving and resetting a client's report format (UC-K3). The caller resolved the client for the firm. Presentation only: no figure
 * moves, so the change is recorded in the client's history but needs no open period.
 */
export async function saveReportFormat(db: Db, input: { clientId: string; actorId?: string | null; format: unknown }): Promise<ReportFormat> {
  const format = validateFormat(input.format);
  if (format.source !== undefined) format.source = format.source.trim() || undefined;
  return db.$transaction(async (tx) => {
    const client = await tx.client.findUniqueOrThrow({ where: { id: input.clientId }, select: { firmId: true } });
    await tx.reportFormat.upsert({
      where: { clientId: input.clientId },
      create: { firmId: client.firmId, clientId: input.clientId, format, updatedById: input.actorId ?? null },
      update: { format, updatedById: input.actorId ?? null },
    });
    await recordEvent(tx, { clientId: input.clientId, kind: "REPORT_FORMAT", subject: "format-laporan", summary: `Format laporan disimpan${format.source ? ` (sumber: ${format.source})` : ""}`, actorId: input.actorId });
    return format;
  });
}

/** Back to the standard format: the client's row goes, so the standard (today's layout, kept current) applies. */
export async function resetReportFormat(db: Db, input: { clientId: string; actorId?: string | null }) {
  await db.$transaction(async (tx) => {
    const { count } = await tx.reportFormat.deleteMany({ where: { clientId: input.clientId } });
    if (count) await recordEvent(tx, { clientId: input.clientId, kind: "REPORT_FORMAT", subject: "format-laporan", summary: "Format laporan kembali ke standar", actorId: input.actorId });
  });
}

/** What the editor offers per statement: every line it must place, with Buku's name for it. */
export const formatUniverse = (): Record<StatementKey, { line: string; label: string }[]> => ({
  labaRugi: STATEMENT_LINES.labaRugi.map((line) => ({ line, label: lineLabel(line) })),
  neraca: STATEMENT_LINES.neraca.map((line) => ({ line, label: lineLabel(line) })),
});

export { FormatError };
