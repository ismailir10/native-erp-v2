import type { Db, Tx } from "@/lib/db";
import { formatRate, invertRate, parseRate } from "@/lib/fx/currency";

/**
 * Exchange-rate table (ADR 0006): rows are typed in or taken from an imported file — never fetched live.
 * A rate row says: 1 `currency` = `rate` `quote`.
 */

export type RateRow = { currency: string; quote: string; date: Date; kind: "SPOT" | "AVERAGE"; rate: string };

/** Latest SPOT on or before `date` for (currency → quote); falls back to the inverse pair. Pure, for plan-time lookups. */
export function lookupRate(rows: RateRow[], currency: string, quote: string, date: Date, kind: "SPOT" | "AVERAGE" = "SPOT"): string | null {
  if (currency === quote) return "1";
  const pick = (c: string, q: string) =>
    rows
      .filter((r) => r.currency === c && r.quote === q && r.kind === kind && +r.date <= +date)
      .sort((a, b) => +b.date - +a.date)[0] ?? null;
  const direct = pick(currency, quote);
  if (direct) return direct.rate;
  const inverse = pick(quote, currency);
  return inverse ? invertRate(inverse.rate) : null;
}

export async function loadRates(db: Db | Tx, firmId: string): Promise<RateRow[]> {
  const rows = await db.exchangeRate.findMany({ where: { firmId }, orderBy: { date: "asc" } });
  return rows.map((r) => ({ currency: r.currency, quote: r.quote, date: r.date, kind: r.kind, rate: r.rate }));
}

export async function upsertRate(db: Db | Tx, firmId: string, r: RateRow & { source?: "MANUAL" | "FILE"; note?: string | null }) {
  const rate = formatRate(parseRate(r.rate));
  return db.exchangeRate.upsert({
    where: { firmId_currency_quote_date_kind: { firmId, currency: r.currency, quote: r.quote, date: r.date, kind: r.kind } },
    create: { firmId, currency: r.currency, quote: r.quote, date: r.date, kind: r.kind, rate, source: r.source ?? "MANUAL", note: r.note ?? null },
    update: { rate, source: r.source ?? "MANUAL", note: r.note ?? null },
  });
}
