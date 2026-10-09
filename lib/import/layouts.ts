import type { Db } from "@/lib/db";

/** *Lupakan pemetaan ini*: the firm's remembered layout is deleted; imports read with it stay as they are. Another firm's id deletes nothing. */
export async function forgetLayout(db: Db, firmId: string, layoutId: string): Promise<boolean> {
  return (await db.statementLayout.deleteMany({ where: { id: layoutId, firmId } })).count > 0;
}
