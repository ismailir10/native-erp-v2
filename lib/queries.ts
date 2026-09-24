import { prisma } from "@/lib/db";
import { runControls } from "@/lib/controls";

/** Read models shared by pages. All derive from GL/transactions at read time. */
export async function clientStatuses(firmId: string, year: number, month: number) {
  const clients = await prisma.client.findMany({ where: { firmId }, include: { entities: true }, orderBy: { name: "asc" } });
  return Promise.all(
    clients.map(async (c) => {
      const [period, openReview, lastImport, controls] = await Promise.all([
        prisma.period.findUnique({ where: { clientId_year_month: { clientId: c.id, year, month } } }),
        prisma.bankTransaction.count({ where: { bankAccount: { entity: { clientId: c.id } }, status: "NEEDS_REVIEW" } }),
        prisma.statementImport.findFirst({ where: { bankAccount: { entity: { clientId: c.id } } }, orderBy: { createdAt: "desc" } }),
        runControls(prisma, c.id, year, month),
      ]);
      const counts = { PASS: 0, REVIEW: 0, FAIL: 0 };
      for (const k of controls) counts[k.status]++;
      const missingStatements = controls.filter((k) => k.key.startsWith("bank:") && k.detail.includes("belum diimpor")).length;
      const state =
        period?.status === "LOCKED"
          ? ("LOCKED" as const)
          : counts.FAIL > 0
            ? ("FAIL" as const)
            : missingStatements > 0
              ? ("WAITING" as const)
              : openReview > 0
                ? ("REVIEW" as const)
                : counts.REVIEW > 0
                  ? ("ACK" as const)
                  : ("READY" as const);
      return { client: c, period, openReview, lastImport, counts, missingStatements, state };
    }),
  );
}

export type ClientState = Awaited<ReturnType<typeof clientStatuses>>[number]["state"];

export const STATE_LABEL: Record<ClientState, { label: string; status: "PASS" | "REVIEW" | "FAIL" }> = {
  LOCKED: { label: "Buku ditutup", status: "PASS" },
  READY: { label: "Siap tutup buku", status: "PASS" },
  ACK: { label: "Kontrol perlu catatan", status: "REVIEW" },
  REVIEW: { label: "Perlu review", status: "REVIEW" },
  WAITING: { label: "Menunggu mutasi", status: "REVIEW" },
  FAIL: { label: "Ada kontrol gagal", status: "FAIL" },
};

/** Share of bank lines coded without a human, per month — the "gets smarter" metric. */
export async function automationByMonth(clientIds: string[]) {
  const rows = await prisma.$queryRaw<{ ym: string; total: bigint; auto: bigint; ai: bigint }[]>`
    SELECT to_char(t.date, 'YYYY-MM') AS ym,
           count(*) AS total,
           count(*) FILTER (WHERE t.method IN ('TRANSFER','RULE','MEMORY')) AS auto,
           count(*) FILTER (WHERE t.method = 'AI') AS ai
    FROM "BankTransaction" t
    JOIN "BankAccount" b ON b.id = t."bankAccountId"
    JOIN "Entity" e ON e.id = b."entityId"
    WHERE e."clientId" = ANY(${clientIds})
    GROUP BY 1 ORDER BY 1`;
  return rows.map((r) => ({ ym: r.ym, total: Number(r.total), auto: Number(r.auto), ai: Number(r.ai), pct: Number(r.total) ? Math.round((Number(r.auto) / Number(r.total)) * 100) : 0 }));
}
