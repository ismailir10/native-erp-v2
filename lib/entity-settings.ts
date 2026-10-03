import type { Db } from "@/lib/db";
import { isFramework } from "@/lib/reports/framework";
import { recordEvent } from "@/lib/audit";
import { fiscalSpan, isFiscalEndMonth } from "@/lib/fiscal";
import { formatPeriod } from "@/lib/format";

export class EntitySettingsError extends Error {}

/** The framework an entity's report set names (wording only, see lib/reports/framework.ts). The caller resolved the client for the firm. */
export async function setReportingFramework(db: Db, input: { clientId: string; entityId: string; framework: string }) {
  if (!isFramework(input.framework)) throw new EntitySettingsError("Pilih kerangka pelaporan.");
  const entity = await db.entity.findFirst({ where: { id: input.entityId, clientId: input.clientId }, select: { id: true } });
  if (!entity) throw new EntitySettingsError("Entitas tidak ditemukan.");
  return db.entity.update({ where: { id: entity.id }, data: { reportingFramework: input.framework } });
}

/**
 * The client's financial-year end (lib/fiscal.ts). It moves no posted figure, only the year reports count from, so it is refused once any
 * month is closed: a closed set of statements never changes underneath. Recorded in the client's history.
 */
export async function setFiscalYearEnd(db: Db, input: { clientId: string; endMonth: unknown; actorId?: string | null }) {
  if (!isFiscalEndMonth(input.endMonth)) throw new EntitySettingsError("Pilih bulan akhir tahun buku.");
  const endMonth = input.endMonth;
  return db.$transaction(async (tx) => {
    const client = await tx.client.findUniqueOrThrow({ where: { id: input.clientId }, select: { fiscalYearEndMonth: true } });
    if (client.fiscalYearEndMonth === endMonth) return;
    const locked = await tx.period.findFirst({ where: { clientId: input.clientId, status: "LOCKED" }, orderBy: [{ year: "desc" }, { month: "desc" }], select: { year: true, month: true } });
    if (locked) throw new EntitySettingsError(`Tahun buku tidak bisa diubah setelah ada bulan yang ditutup (${formatPeriod(locked.year, locked.month)}). Buka kunci bulannya dulu.`);
    await tx.client.update({ where: { id: input.clientId }, data: { fiscalYearEndMonth: endMonth } });
    await recordEvent(tx, {
      clientId: input.clientId,
      kind: "FISCAL_YEAR",
      subject: "tahun-buku",
      summary: `Tahun buku diubah: ${fiscalSpan(client.fiscalYearEndMonth)} → ${fiscalSpan(endMonth)}`,
      before: { fiscalYearEndMonth: client.fiscalYearEndMonth },
      after: { fiscalYearEndMonth: endMonth },
      actorId: input.actorId,
    });
  });
}
