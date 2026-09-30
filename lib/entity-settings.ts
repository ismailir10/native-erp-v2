import type { Db } from "@/lib/db";
import { isFramework } from "@/lib/reports/framework";

export class EntitySettingsError extends Error {}

/** The framework an entity's report set names (wording only, see lib/reports/framework.ts). The caller resolved the client for the firm. */
export async function setReportingFramework(db: Db, input: { clientId: string; entityId: string; framework: string }) {
  if (!isFramework(input.framework)) throw new EntitySettingsError("Pilih kerangka pelaporan.");
  const entity = await db.entity.findFirst({ where: { id: input.entityId, clientId: input.clientId }, select: { id: true } });
  if (!entity) throw new EntitySettingsError("Entitas tidak ditemukan.");
  return db.entity.update({ where: { id: entity.id }, data: { reportingFramework: input.framework } });
}
