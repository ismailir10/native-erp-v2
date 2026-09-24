import { prisma } from "@/lib/db";

/** Months that actually have bank data, newest first. Drives the period picker + default period. */
export async function dataMonths(clientIds: string[]): Promise<{ year: number; month: number }[]> {
  if (clientIds.length === 0) return [];
  const rows = await prisma.$queryRaw<{ y: number; m: number }[]>`
    SELECT DISTINCT EXTRACT(YEAR FROM t.date)::int AS y, EXTRACT(MONTH FROM t.date)::int AS m
    FROM "BankTransaction" t
    JOIN "Entity" e ON e.id = t."entityId"
    WHERE e."clientId" = ANY(${clientIds})
    ORDER BY 1 DESC, 2 DESC`;
  return rows.map((r) => ({ year: r.y, month: r.m }));
}

/** The month an accountant is working on: latest month with data (falls back to today). */
export async function workingMonth(clientIds: string[]) {
  const [latest] = await dataMonths(clientIds);
  if (latest) return latest;
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}
