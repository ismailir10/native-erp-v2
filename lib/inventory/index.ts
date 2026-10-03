import { financialYear, fiscalEndMonth } from "@/lib/fiscal";
import type { Db, Tx } from "@/lib/db";
import { ACCOUNT_CODES } from "@/lib/coa/template";
import { templateAccounts } from "@/lib/coa/ensure";
import { closeLock } from "@/lib/adjust/schedules";
import { TRADING } from "@/lib/controls/sanity";
import { LedgerError, postJournal } from "@/lib/ledger/post";
import { formatDate, formatPeriod, periodBounds } from "@/lib/format";

/**
 * Persediaan & HPP, periodic method (accounting-rules 5i). Purchases go to cost of sales (5100) as they are paid; at a month end the
 * accountant types the stock count and one ADJUSTMENT brings Persediaan (every PERSEDIAAN account, adjusted on 1160) to it against
 * 5190 Perubahan Persediaan, so HPP = persediaan awal + pembelian − persediaan akhir. The GL stays the truth: the book value is read,
 * never stored; the count row records what was counted and the journal it produced.
 */

async function inventoryAccountIds(db: Db | Tx, clientId: string) {
  return (await db.account.findMany({ where: { clientId, fsLine: "PERSEDIAAN" }, select: { id: true } })).map((a) => a.id);
}

/** Persediaan in the books of these entities through `asOf` (all PERSEDIAAN accounts, debit − credit). Optionally from a date. */
export async function inventoryBalance(db: Db | Tx, clientId: string, entityIds: string[], range: { from?: Date; to: Date }, where: { openingOnly?: boolean; excludeOpening?: boolean } = {}) {
  const ids = await inventoryAccountIds(db, clientId);
  if (!ids.length) return 0n;
  const s = await db.journalLine.aggregate({
    where: {
      entityId: { in: entityIds },
      accountId: { in: ids },
      date: { gte: range.from, lte: range.to },
      ...(where.openingOnly ? { entry: { kind: "OPENING" } } : where.excludeOpening ? { entry: { kind: { not: "OPENING" } } } : {}),
    },
    _sum: { debit: true, credit: true },
  });
  return (s._sum.debit ?? 0n) - (s._sum.credit ?? 0n);
}

/**
 * Whether the month-end count matters for this entity: it holds inventory, it has been counted before, or it is a trading business
 * whose cost of sales moved this financial year (lib/fiscal.ts).
 */
async function applies(db: Db | Tx, clientId: string, entityId: string, industry: string | null, year: number, month: number, book: bigint) {
  if (book !== 0n) return true;
  if (await db.inventoryCount.count({ where: { entityId, OR: [{ year: { lt: year } }, { year, month: { lte: month } }] } })) return true;
  if (!industry || !TRADING.test(industry)) return false;
  const cogs = await db.journalLine.count({ where: { entityId, account: { fsLine: "HPP" }, date: { gte: financialYear(await fiscalEndMonth(db, clientId), year, month).start, lte: periodBounds(year, month).end } } });
  return cogs > 0;
}

export type InventoryRow = {
  entityId: string;
  entity: string;
  currency: string;
  applies: boolean;
  /** Persediaan in the books at the month end. */
  book: bigint;
  count: { amount: bigint; bookBefore: bigint; entryId: string | null; note: string | null; by: string | null; at: Date } | null;
  /** The latest earlier count (for the page's "last counted" hint). */
  previous: { year: number; month: number; amount: bigint } | null;
  /** A later month already counted: this month can no longer be counted (it would move that count's books). */
  later: { year: number; month: number } | null;
  /** The month's purchases on cost of sales (HPP accounts other than 5190), for context on the page. */
  purchasesMonth: bigint;
};

export async function inventoryRows(db: Db | Tx, clientId: string, year: number, month: number, entityIds?: string[]): Promise<InventoryRow[]> {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, select: { industry: true, entities: { select: { id: true, shortName: true, functionalCurrency: true, kind: true }, orderBy: { name: "asc" } } } });
  const { start, end } = periodBounds(year, month);
  const entities = client.entities.filter((e) => !entityIds || entityIds.includes(e.id)).sort((a, b) => Number(a.kind === "PERORANGAN") - Number(b.kind === "PERORANGAN"));
  return Promise.all(
    entities.map(async (e) => {
      const book = await inventoryBalance(db, clientId, [e.id], { to: end });
      const [count, previous, later, cogs] = await Promise.all([
        db.inventoryCount.findUnique({ where: { entityId_year_month: { entityId: e.id, year, month } }, include: { countedBy: { select: { name: true } } } }),
        db.inventoryCount.findFirst({ where: { entityId: e.id, OR: [{ year: { lt: year } }, { year, month: { lt: month } }] }, orderBy: [{ year: "desc" }, { month: "desc" }] }),
        db.inventoryCount.findFirst({ where: { entityId: e.id, OR: [{ year: { gt: year } }, { year, month: { gt: month } }] }, orderBy: [{ year: "asc" }, { month: "asc" }] }),
        db.journalLine.aggregate({ where: { entityId: e.id, account: { fsLine: "HPP", code: { not: ACCOUNT_CODES.INVENTORY_CHANGE } }, date: { gte: start, lte: end } }, _sum: { debit: true, credit: true } }),
      ]);
      return {
        entityId: e.id,
        entity: e.shortName,
        currency: e.functionalCurrency,
        applies: await applies(db, clientId, e.id, client.industry, year, month, book),
        book,
        count: count ? { amount: count.amount, bookBefore: count.bookBefore, entryId: count.entryId, note: count.note, by: count.countedBy?.name ?? null, at: count.updatedAt } : null,
        previous: previous ? { year: previous.year, month: previous.month, amount: previous.amount } : null,
        later: later ? { year: later.year, month: later.month } : null,
        purchasesMonth: (cogs._sum.debit ?? 0n) - (cogs._sum.credit ?? 0n),
      };
    }),
  );
}

export type CountInput = { clientId: string; entityId: string; year: number; month: number; amount: bigint; note?: string | null; actorId?: string | null };

/**
 * Records the month-end count by the accountant's click: one ADJUSTMENT dated the month end for the difference between the count and
 * the books (an increase Dr 1160 / Cr 5190, a decrease the reverse), none when they are equal. Counting a month again books only the new
 * difference. Refused in a locked month and once a later month is counted. Serialised with the close and per entity.
 */
export async function recordInventoryCount(db: Db, input: CountInput) {
  const entity = await db.entity.findFirst({ where: { id: input.entityId, clientId: input.clientId } });
  if (!entity) throw new LedgerError("Pilih entitas.");
  if (!(Number.isInteger(input.year) && Number.isInteger(input.month) && input.month >= 1 && input.month <= 12)) throw new LedgerError("Periode tidak valid.");
  if (input.amount < 0n) throw new LedgerError("Nilai persediaan tidak boleh negatif.");
  const { end } = periodBounds(input.year, input.month);
  const label = formatPeriod(input.year, input.month);
  const note = input.note?.trim() || null;

  return db.$transaction(async (tx) => {
    await closeLock(tx, input.clientId);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`inv:${entity.id}`}, 0))::text`;
    const period = await tx.period.findUnique({ where: { clientId_year_month: { clientId: input.clientId, year: input.year, month: input.month } } });
    if (period?.status === "LOCKED") throw new LedgerError(`Periode ${label} sudah ditutup. Buka kembali dulu untuk mencatat persediaan.`);
    const later = await tx.inventoryCount.findFirst({ where: { entityId: entity.id, OR: [{ year: { gt: input.year } }, { year: input.year, month: { gt: input.month } }] }, orderBy: [{ year: "asc" }, { month: "asc" }] });
    if (later) {
      throw new LedgerError(`Persediaan ${formatPeriod(later.year, later.month)} sudah dicatat. Koreksi hitungan lewat bulan itu atau sesudahnya.`);
    }
    const book = await inventoryBalance(tx, input.clientId, [entity.id], { to: end });
    const diff = input.amount - book;
    let entryId: string | null = null;
    if (diff !== 0n) {
      const ids = await templateAccounts(tx, input.clientId, [ACCOUNT_CODES.INVENTORY, ACCOUNT_CODES.INVENTORY_CHANGE]);
      const [stock, change] = [ids.get(ACCOUNT_CODES.INVENTORY)!, ids.get(ACCOUNT_CODES.INVENTORY_CHANGE)!];
      const entry = await postJournal(tx, {
        entityId: entity.id,
        date: end,
        kind: "ADJUSTMENT",
        memo: `Persediaan akhir ${formatDate(end)} (stock opname): ${diff > 0n ? "kenaikan" : "penurunan"} persediaan`,
        lines: diff > 0n ? [{ accountId: stock, debit: diff }, { accountId: change, credit: diff }] : [{ accountId: change, debit: -diff }, { accountId: stock, credit: -diff }],
        actorId: input.actorId,
      });
      entryId = entry.id;
    }
    const key = { entityId_year_month: { entityId: entity.id, year: input.year, month: input.month } };
    const existing = await tx.inventoryCount.findUnique({ where: key });
    const data = { amount: input.amount, bookBefore: book, note, countedById: input.actorId ?? null, entryId: entryId ?? existing?.entryId ?? null };
    return tx.inventoryCount.upsert({ where: key, update: data, create: { ...data, firmId: entity.firmId, clientId: input.clientId, entityId: entity.id, year: input.year, month: input.month } });
  });
}

/**
 * Cost of sales of a scope over a range, the periodic way: persediaan awal + pembelian (HPP accounts other than 5190) + what was put
 * on Persediaan directly (purchases booked to it, other adjustments) − persediaan akhir = HPP. Opening entries dated in the range count
 * as the start ("awal"), never a movement. The identity holds by construction, so it always equals the Laba Rugi line.
 */
export async function cogsBreakdown(db: Db | Tx, clientId: string, entityIds: string[], from: Date, to: Date) {
  const dayBefore = new Date(from.getTime() - 86_400_000);
  const [before, openingInRange, movement, hpp, change] = await Promise.all([
    inventoryBalance(db, clientId, entityIds, { to: dayBefore }),
    inventoryBalance(db, clientId, entityIds, { from, to }, { openingOnly: true }),
    inventoryBalance(db, clientId, entityIds, { from, to }, { excludeOpening: true }),
    db.journalLine.aggregate({ where: { entityId: { in: entityIds }, account: { fsLine: "HPP" }, date: { gte: from, lte: to } }, _sum: { debit: true, credit: true } }),
    db.journalLine.aggregate({ where: { entityId: { in: entityIds }, account: { clientId, code: ACCOUNT_CODES.INVENTORY_CHANGE }, date: { gte: from, lte: to } }, _sum: { debit: true, credit: true } }),
  ]);
  const total = (hpp._sum.debit ?? 0n) - (hpp._sum.credit ?? 0n);
  const m5190 = (change._sum.debit ?? 0n) - (change._sum.credit ?? 0n);
  const opening = before + openingInRange;
  const closing = opening + movement;
  return { opening, purchases: total - m5190, direct: movement + m5190, closing, total };
}
