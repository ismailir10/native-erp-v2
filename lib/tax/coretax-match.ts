/**
 * Matching Coretax documents (faktur, bukti potong) to what the books hold (I5c, I5d): one to one on the exact amount. Among equal amounts
 * the same NPWP wins, then a shared name word, then the nearest date. Deterministic; nothing is posted from a match.
 */
export type Side<T> = { item: T; key: string; date: Date; amount: bigint; npwp?: string | null; text: string };

/** NPWP digits; a company's 16-digit NPWP (since 2024) is "0" + its 15-digit one, so both read the same. */
export const npwpDigits = (s: string | null | undefined) => {
  const d = (s ?? "").replace(/\D/g, "");
  return d.length === 16 && d.startsWith("0") ? d.slice(1) : d;
};

const NAME_NOISE = new Set(["PT", "CV", "TBK", "UD", "PERSERO", "INDONESIA", "TRSF", "TRANSFER", "DARI", "BANKING", "KE", "DB", "CR"]);
const words = (s: string) => new Set(s.toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length >= 4 && !NAME_NOISE.has(w)));

export function matchOneToOne<D, B>(docs: Side<D>[], book: Side<B>[]): { matched: { doc: D; book: B }[]; unmatchedDocs: D[]; unmatchedBook: B[] } {
  const free = new Set(book.map((b) => b.key));
  const matched: { doc: D; book: B }[] = [];
  const unmatchedDocs: D[] = [];
  for (const d of [...docs].sort((a, b) => +a.date - +b.date || a.key.localeCompare(b.key))) {
    const dw = words(d.text);
    const npwp = npwpDigits(d.npwp);
    const score = (b: Side<B>) => (npwp && npwp === npwpDigits(b.npwp) ? 2 : [...words(b.text)].some((w) => dw.has(w)) ? 1 : 0);
    const best = book
      .filter((b) => free.has(b.key) && b.amount === d.amount)
      .sort((x, y) => score(y) - score(x) || Math.abs(+x.date - +d.date) - Math.abs(+y.date - +d.date) || x.key.localeCompare(y.key))[0];
    if (best) {
      free.delete(best.key);
      matched.push({ doc: d.item, book: best.item });
    } else unmatchedDocs.push(d.item);
  }
  return { matched, unmatchedDocs, unmatchedBook: book.filter((b) => free.has(b.key)).map((b) => b.item) };
}
