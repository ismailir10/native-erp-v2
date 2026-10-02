import type { Db } from "@/lib/db";
import { ACCOUNT_CODES } from "@/lib/coa/template";
import { periodBounds } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { dueProposals } from "@/lib/adjust/schedules";
import { inventoryRows } from "@/lib/inventory";
import { openingDate, statementCoverage } from "@/lib/controls/coverage";
import { findingLabel } from "@/lib/findings";

/**
 * What a set of statements is (accounting-rules 12): **final** once the month is closed, else a **draft**, with what still makes it one —
 * an undecided Saldo Awal difference (Temuan), lines in Review, money on Belum Terklasifikasi (1999), missing statements, due scheduled journals, a missing stock count. Read-only; the
 * close controls stay the authority. Figures are the scope's own (minor units); the page links each reason to where it is fixed.
 */
export type ReportReason =
  /** Saldo Awal differences still on 3290 (ADR 0012), per entity in its own currency, with the open Temuan numbers. */
  | { kind: "findings"; items: { entity: string; amount: bigint; currency: string; labels: string[] }[] }
  | { kind: "review"; count: number }
  /** Per entity in its own currency: a mixed-currency scope never adds minor units of different currencies (rule 6). */
  | { kind: "suspense"; items: { entity: string; amount: bigint; currency: string }[] }
  | { kind: "statements"; accounts: string[] }
  | { kind: "schedules"; count: number }
  | { kind: "inventory"; entities: string[] };

export type ReportStatus = { locked: { by: string | null; at: Date | null } | null; reasons: ReportReason[] };

export async function reportStatus(db: Db, clientId: string, entityIds: string[], year: number, month: number): Promise<ReportStatus> {
  const { start, end } = periodBounds(year, month);
  const period = await db.period.findUnique({ where: { clientId_year_month: { clientId, year, month } }, include: { lockedBy: { select: { name: true } } } });
  const locked = period?.status === "LOCKED" ? { by: period.lockedBy?.name ?? null, at: period.lockedAt } : null;
  const entities = await db.entity.findMany({ where: { id: { in: entityIds }, clientId }, include: { bankAccounts: true } });
  const reasons: ReportReason[] = [];

  const diffs = await db.journalLine.groupBy({ by: ["entityId"], where: { entityId: { in: entityIds }, account: { clientId, code: ACCOUNT_CODES.OPENING_DIFFERENCE }, date: { lte: end } }, _sum: { debit: true, credit: true } });
  const undecided = diffs.map((g) => ({ g, amount: (g._sum.debit ?? 0n) - (g._sum.credit ?? 0n) })).filter((x) => x.amount !== 0n);
  if (undecided.length) {
    const open = await db.finding.findMany({ where: { entityId: { in: undecided.map((x) => x.g.entityId) }, status: "OPEN" }, orderBy: { number: "asc" }, select: { entityId: true, number: true } });
    reasons.push({
      kind: "findings",
      items: undecided.map(({ g, amount }) => {
        const e = entities.find((x) => x.id === g.entityId)!;
        return { entity: e.shortName, currency: e.functionalCurrency, amount: amount < 0n ? -amount : amount, labels: open.filter((f) => f.entityId === g.entityId).map((f) => findingLabel(f.number)) };
      }),
    });
  }

  const review = await db.bankTransaction.count({ where: { entityId: { in: entityIds }, status: "NEEDS_REVIEW", date: { lte: end } } });
  if (review) reasons.push({ kind: "review", count: review });
  const suspense = await db.journalLine.groupBy({ by: ["entityId"], where: { entityId: { in: entityIds }, account: { clientId, code: ACCOUNT_CODES.SUSPENSE }, date: { lte: end } }, _sum: { debit: true, credit: true } });
  const held = suspense
    .map((g) => { const e = entities.find((x) => x.id === g.entityId)!; return { entity: e.shortName, currency: e.functionalCurrency, amount: (g._sum.debit ?? 0n) - (g._sum.credit ?? 0n) }; })
    .filter((x) => x.amount !== 0n);
  if (held.length) reasons.push({ kind: "suspense", items: held });

  const missing: string[] = [];
  for (const e of entities) {
    const opening = await openingDate(db, e.id);
    for (const ba of e.bankAccounts) if ((await statementCoverage(db, ba.id, opening, start, end)).state === "missing") missing.push(ba.label);
  }
  if (missing.length) reasons.push({ kind: "statements", accounts: missing });

  if (!locked) {
    const due = (await Promise.all(entityIds.map((id) => dueProposals(db, clientId, year, month, id)))).flat();
    if (due.length) reasons.push({ kind: "schedules", count: due.length });
  }
  const stock = (await inventoryRows(db, clientId, year, month, entityIds)).filter((r) => r.applies && (!r.count || r.count.amount !== r.book));
  if (stock.length) reasons.push({ kind: "inventory", entities: stock.map((r) => r.entity) });
  return { locked, reasons };
}

/** One line per reason, in Bahasa, each amount in its entity's currency (the page renders links; the Excel prints this). */
export function reasonText(r: ReportReason): string {
  switch (r.kind) {
    case "findings": return `temuan selisih saldo awal belum diputuskan: ${r.items.map((i) => `${[...i.labels, r.items.length > 1 ? i.entity : ""].filter(Boolean).join(" ")} ${formatMoney(i.amount, i.currency)}`.trim()).join(", ")}`;
    case "review": return `${r.count} transaksi masih di Review`;
    case "suspense": return `Belum Terklasifikasi (1999) ${r.items.map((i) => (r.items.length > 1 ? `${i.entity} ` : "") + formatMoney(i.amount, i.currency)).join(", ")}`;
    case "statements": return `rekening koran belum lengkap: ${r.accounts.join(", ")}`;
    case "schedules": return `${r.count} jurnal terjadwal belum dicatat`;
    case "inventory": return `persediaan akhir belum dicatat: ${r.entities.join(", ")}`;
  }
}
