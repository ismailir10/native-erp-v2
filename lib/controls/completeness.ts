import type { Db } from "@/lib/db";
import { periodBounds } from "@/lib/format";
import { openingDate } from "@/lib/controls/coverage";

/**
 * Kelengkapan rekening koran (use-case feedback UC-B4): every bank account × month from where its books start to the month asked —
 * *ada* (a statement covers it and its running balance holds), *bolong* (no statement), or *tidak nyambung* (the statement's opening
 * differs from the previous statement's closing, or its running balance breaks inside the file), with the difference when there is
 * one. Read-only: the bank reconciliation and continuity controls stay the authority; this is the picture of where the gaps are.
 */
export type CellState = "ok" | "missing" | "broken" | "before";
export type CompletenessCell = { year: number; month: number; state: CellState; diff: bigint | null; note: string | null };
export type CompletenessRow = { bankAccountId: string; entity: string; label: string; currency: string; cells: CompletenessCell[] };

const DAY = 86_400_000;

export async function completenessMatrix(db: Db, clientId: string, year: number, month: number, monthsShown = 6) {
  const months = Array.from({ length: monthsShown }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1 - (monthsShown - 1 - i), 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  });
  const entities = (await db.entity.findMany({ where: { clientId }, include: { bankAccounts: { orderBy: { label: "asc" } } }, orderBy: { name: "asc" } })).sort(
    (a, b) => Number(a.kind === "PERORANGAN") - Number(b.kind === "PERORANGAN"),
  );
  const rows: CompletenessRow[] = [];
  for (const e of entities) {
    const opening = await openingDate(db, e.id);
    for (const ba of e.bankAccounts) {
      const statements = await db.statementImport.findMany({ where: { bankAccountId: ba.id }, orderBy: [{ periodStart: "asc" }, { createdAt: "asc" }] });
      // The books of this account start the day after the Saldo Awal, else at its first statement; nothing to ask before that.
      const startsAt = opening ? new Date(+opening + DAY) : statements[0]?.periodStart ?? null;
      const cells = months.map(({ year: y, month: m }): CompletenessCell => {
        const { start, end } = periodBounds(y, m);
        if (!startsAt || +end < +startsAt) return { year: y, month: m, state: "before", diff: null, note: null };
        const covering = statements.filter((s) => +s.periodStart <= +end && +s.periodEnd >= +start);
        if (!covering.length) return { year: y, month: m, state: "missing", diff: null, note: null };
        const first = covering[0];
        const previous = [...statements].reverse().find((s) => +s.periodEnd < +first.periodStart);
        if (previous && previous.closingBalance !== first.openingBalance) {
          return { year: y, month: m, state: "broken", diff: first.openingBalance - previous.closingBalance, note: `Saldo awal ${first.fileName} tidak sama dengan saldo akhir ${previous.fileName}` };
        }
        const inside = covering.find((s) => !s.continuityOk);
        if (inside) return { year: y, month: m, state: "broken", diff: null, note: `${inside.fileName}: ${inside.continuityNote ?? "saldo berjalan putus"}` };
        return { year: y, month: m, state: "ok", diff: null, note: null };
      });
      if (cells.every((c) => c.state === "before")) continue;
      rows.push({ bankAccountId: ba.id, entity: e.shortName, label: ba.label, currency: ba.currency, cells });
    }
  }
  // Months before any account's books start are a column of dashes: leave them out.
  const first = months.findIndex((_, i) => rows.some((r) => r.cells[i].state !== "before"));
  const from = first < 0 ? months.length : first;
  return { months: months.slice(from), rows: rows.map((r) => ({ ...r, cells: r.cells.slice(from) })) };
}
