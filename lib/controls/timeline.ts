import type { Db } from "@/lib/db";

/**
 * The close timeline of a client's months (ADR 0014 north-star metric; read-only, never stored): when its files came in, when it was
 * last reviewed, when it was locked, and when a report first left after the lock. Read from records Buku already keeps: imports,
 * the change log (`CLASSIFY`, `REPORT_EXPORT`) and the period lock.
 */
export type MonthTimeline = {
  year: number;
  month: number;
  files: number;
  firstFileAt: Date | null;
  lastFileAt: Date | null;
  lastReviewAt: Date | null;
  lockedAt: Date | null;
  firstSentAt: Date | null;
  /** First file in → lock, and first file in → first report out after the lock; null while either end is missing. */
  toLockMs: number | null;
  toSentMs: number | null;
};

const key = (y: number, m: number) => y * 12 + (m - 1);
const monthsOf = (start: Date, end: Date) => {
  const out: number[] = [];
  for (let k = key(start.getUTCFullYear(), start.getUTCMonth() + 1); k <= key(end.getUTCFullYear(), end.getUTCMonth() + 1); k++) out.push(k);
  return out;
};

export async function closeTimeline(db: Db, clientId: string, only?: { year: number; month: number }): Promise<MonthTimeline[]> {
  const [statements, ledgers, periods, events] = await Promise.all([
    db.statementImport.findMany({ where: { bankAccount: { entity: { clientId } } }, select: { periodStart: true, periodEnd: true, createdAt: true } }),
    db.ledgerImport.findMany({ where: { clientId }, select: { periodStart: true, periodEnd: true, createdAt: true } }),
    db.period.findMany({ where: { clientId }, select: { year: true, month: true, lockedAt: true } }),
    db.auditEvent.findMany({ where: { clientId, kind: { in: ["CLASSIFY", "REPORT_EXPORT"] } }, select: { kind: true, subject: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
  ]);

  const months = new Map<number, { files: Date[]; reviews: Date[]; sent: Date[]; lockedAt: Date | null }>();
  const at = (k: number) => {
    let m = months.get(k);
    if (!m) months.set(k, (m = { files: [], reviews: [], sent: [], lockedAt: null }));
    return m;
  };
  for (const f of [...statements, ...ledgers]) for (const k of monthsOf(f.periodStart, f.periodEnd)) at(k).files.push(f.createdAt);
  for (const p of periods) at(key(p.year, p.month)).lockedAt = p.lockedAt;

  // A review belongs to the month of the bank line it changed (subject `bankTx:<id>`); an export names its period (`period:YYYY-MM`).
  const txIds = events.filter((e) => e.kind === "CLASSIFY" && e.subject.startsWith("bankTx:")).map((e) => e.subject.slice(7));
  const txDates = new Map(
    (await db.bankTransaction.findMany({ where: { id: { in: [...new Set(txIds)] } }, select: { id: true, date: true } })).map((t) => [t.id, t.date]),
  );
  for (const e of events) {
    if (e.kind === "CLASSIFY") {
      const d = txDates.get(e.subject.slice(7));
      if (d) at(key(d.getUTCFullYear(), d.getUTCMonth() + 1)).reviews.push(e.createdAt);
    } else {
      const m = e.subject.match(/^period:(\d{4})-(\d{2})$/);
      if (m) at(key(Number(m[1]), Number(m[2]))).sent.push(e.createdAt);
    }
  }

  const min = (ds: Date[]) => (ds.length ? new Date(Math.min(...ds.map(Number))) : null);
  const max = (ds: Date[]) => (ds.length ? new Date(Math.max(...ds.map(Number))) : null);
  return [...months.entries()]
    .filter(([k]) => !only || k === key(only.year, only.month))
    .filter(([, m]) => m.files.length || m.lockedAt || m.sent.length)
    .sort(([a], [b]) => a - b)
    .map(([k, m]) => {
      const firstFileAt = min(m.files);
      const firstSentAt = m.lockedAt ? min(m.sent.filter((d) => +d >= +m.lockedAt!)) : null;
      return {
        year: Math.floor(k / 12),
        month: (k % 12) + 1,
        files: m.files.length,
        firstFileAt,
        lastFileAt: max(m.files),
        lastReviewAt: max(m.reviews),
        lockedAt: m.lockedAt,
        firstSentAt,
        toLockMs: firstFileAt && m.lockedAt ? +m.lockedAt - +firstFileAt : null,
        toSentMs: firstFileAt && firstSentAt ? +firstSentAt - +firstFileAt : null,
      };
    });
}

/** "2 hari 3 jam", "45 menit": a duration as an accountant reads it. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} menit`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam ${minutes % 60} menit`;
  return `${Math.floor(hours / 24)} hari ${hours % 24} jam`;
}
