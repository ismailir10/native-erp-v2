import type { Db } from "@/lib/db";
import { PLAN_NOTE } from "@/lib/evidence/answers";

/** Evidence Q&A answer plans in the last `days` days: requested, rejected (billed but unusable or failed), and the rate. */
export async function planRejections(db: Db, firmId: string, days = 30, now = new Date()) {
  const since = new Date(+now - days * 86_400_000);
  const where = { firmId, at: { gte: since }, note: { startsWith: PLAN_NOTE } };
  const [requested, rejected] = await Promise.all([db.aiUsage.count({ where }), db.aiUsage.count({ where: { ...where, ok: false } })]);
  return { days, requested, rejected, rate: requested ? rejected / requested : 0 };
}
