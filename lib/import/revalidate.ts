import type { Db } from "@/lib/db";
import type { ParsedStatement } from "@/lib/import/types";
import type { StatementValidation } from "@/lib/import/validation";
import { rowHashes } from "@/lib/import/normalize";

/** Re-upload can attest an unchanged legacy import, never rewrite its financial rows. */
export async function revalidateLegacy(db: Db, bankAccountId: string, st: ParsedStatement, hashes: string[], validation: StatementValidation, fileName: string) {
  if (!st.rows.length || validation.issues.length || st.rows.some((r) => r.written || r.balanceOnly)) return;
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`import:${bankAccountId}`}, 0))::text`;
    const candidates = await tx.statementImport.findMany({
      where: { bankAccountId, periodStart: st.periodStart, periodEnd: st.periodEnd, openingBalance: st.openingBalance, closingBalance: st.closingBalance, continuityOk: true, duplicateCount: 0, rowCount: st.rows.length },
      include: { transactions: { orderBy: { rowNumber: "asc" } } },
    });
    const expected = [...hashes].sort().join(",");
    const matches = candidates.filter((c) => c.sourceValidation === null && c.transactions.length === st.rows.length
      && c.transactions.map((r) => r.hash).sort().join(",") === expected
      && rowHashes(c.transactions).sort().join(",") === expected);
    if (matches.length !== 1) return;
    await tx.statementImport.update({ where: { id: matches[0].id }, data: {
      sourceValidation: { ...validation, attestation: { at: new Date().toISOString(), fileName } },
      parseNotes: { push: `Sumber divalidasi ulang dari ${fileName}; periode, saldo dan semua mutasi sama persis dengan impor lama. Jurnal tidak diubah.` },
    } });
  });
}
