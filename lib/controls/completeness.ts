import type { Db } from "@/lib/db";
import { periodBounds } from "@/lib/format";
import { openingDate } from "@/lib/controls/coverage";

/**
 * Kelengkapan rekening koran (use-case feedback UC-B4): every bank account × month from where its books start to the month asked —
 * *ada* (statements cover it and their running balance holds), *bolong* (no statement), or *tidak nyambung* (a statement's opening
 * differs from the previous statement's closing, or its running balance breaks inside the file), with the difference when there is
 * one. Gaps are judged by balances, not dates: a file without a period line spans its first to last row, and days without rows
 * between two statements that hand over lost nothing. Books fed by ledger exports get one row of their own (`LEDGER_ROW_ID`). Read-only: the bank reconciliation and continuity controls stay the authority; this is the picture of where the gaps are.
 */
export type CellState = "ok" | "missing" | "broken" | "before";
export type CompletenessCell = { year: number; month: number; state: CellState; diff: bigint | null; note: string | null };
export type CompletenessRow = { kind: "bank" | "ledger"; bankAccountId: string; entity: string; label: string; currency: string; cells: CompletenessCell[] };

/** The one row for books fed by ledger files (Jurnal, Accurate, Zahir exports): a posted ledger or trial-balance import covers its period. */
export const LEDGER_ROW_ID = "ledger";

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
        const cell = (state: CellState, diff: bigint | null = null, note: string | null = null) => ({ year: y, month: m, state, diff, note });
        if (!startsAt || +end < +startsAt) return cell("before");
        const covering = statements.filter((x) => +x.periodStart <= +end && +x.periodEnd >= +start);
        if (!covering.length) return cell("missing");
        // Every statement that starts this month must hand over from the one before it. Overlapping files (a file that starts inside
        // another) carry no comparable opening, so they are not compared.
        for (const x of covering.filter((c) => +c.periodStart >= +start)) {
          if (statements.some((o) => o !== x && +o.periodStart < +x.periodStart && +o.periodEnd >= +x.periodStart)) continue;
          const previous = statements.filter((o) => +o.periodEnd < +x.periodStart).sort((a, b) => +b.periodEnd - +a.periodEnd)[0];
          if (previous && previous.closingBalance !== x.openingBalance) {
            return cell("broken", x.openingBalance - previous.closingBalance, `Saldo awal ${x.fileName} tidak sama dengan saldo akhir ${previous.fileName}`);
          }
        }
        const inside = covering.find((c) => !c.continuityOk);
        if (inside) return cell("broken", null, `${inside.fileName}: ${inside.continuityNote ?? "saldo berjalan putus"}`);
        return cell("ok");
      });
      if (cells.every((c) => c.state === "before")) continue;
      rows.push({ kind: "bank", bankAccountId: ba.id, entity: e.shortName, label: ba.label, currency: ba.currency, cells });
    }
  }
  // Ledger-fed books (I1a): a posted Buku besar or Neraca saldo covers the months of its period; a Neraca alone is an opening and
  // covers none. From the first covered month on, a month no file covers is *bolong*.
  const ledgers = await db.ledgerImport.findMany({
    where: { clientId, status: "POSTED", OR: [{ mode: "LEDGER" }, { data: { path: ["tb"], equals: true } }] },
    select: { periodStart: true, periodEnd: true },
  });
  if (ledgers.length) {
    const firstStart = new Date(Math.min(...ledgers.map((l) => +l.periodStart)));
    const cells = months.map(({ year: y, month: m }): CompletenessCell => {
      const { start, end } = periodBounds(y, m);
      const state: CellState = +end < +firstStart ? "before" : ledgers.some((l) => +l.periodStart <= +end && +l.periodEnd >= +start) ? "ok" : "missing";
      return { year: y, month: m, state, diff: null, note: null };
    });
    if (!cells.every((c) => c.state === "before")) {
      rows.push({ kind: "ledger", bankAccountId: LEDGER_ROW_ID, entity: "Ekspor sistem akuntansi", label: "Buku besar (file)", currency: entities[0]?.functionalCurrency ?? "IDR", cells });
    }
  }
  // Months before any account's books start are a column of dashes: leave them out.
  const first = months.findIndex((_, i) => rows.some((r) => r.cells[i].state !== "before"));
  const from = first < 0 ? months.length : first;
  return { months: months.slice(from), rows: rows.map((r) => ({ ...r, cells: r.cells.slice(from) })) };
}
