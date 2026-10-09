// Pure (no parsers, no database): the batch table runs in the browser.

/**
 * The order a batch is imported in: by account (in the order given), then period start, so every statement hands over to the one before
 * it. Items without an account or a period go last, in the order they came.
 */
export function planBatch<T extends { bankAccountId: string | null; periodStart: string | null }>(items: T[], accountOrder: string[]): T[] {
  const rank = (t: T) => (t.bankAccountId && t.periodStart ? accountOrder.indexOf(t.bankAccountId) : -1);
  return items
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const ra = rank(a.t);
      const rb = rank(b.t);
      if ((ra < 0) !== (rb < 0)) return ra < 0 ? 1 : -1;
      if (ra < 0) return a.i - b.i;
      return ra - rb || (a.t.periodStart! < b.t.periodStart! ? -1 : a.t.periodStart! > b.t.periodStart! ? 1 : a.i - b.i);
    })
    .map((x) => x.t);
}
