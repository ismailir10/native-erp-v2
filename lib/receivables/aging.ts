import type { Db, Tx } from "@/lib/db";
import type { InvoiceDirection } from "@/lib/generated/prisma/enums";

/**
 * Open items and aging at a date (accounting-rules 5c): an invoice issued by then, less its settlements by bank lines dated by then.
 * The subledger is proven against the GL balance of the receivable/payable accounts the invoices use.
 */
export const BUCKETS = ["CURRENT", "D1_30", "D31_60", "D61_90", "OVER_90"] as const;
export type Bucket = (typeof BUCKETS)[number];
export const BUCKET_LABEL: Record<Bucket, string> = { CURRENT: "Belum jatuh tempo", D1_30: "1–30 hari", D31_60: "31–60 hari", D61_90: "61–90 hari", OVER_90: "> 90 hari" };

export function bucketOf(daysPastDue: number): Bucket {
  if (daysPastDue <= 0) return "CURRENT";
  if (daysPastDue <= 30) return "D1_30";
  if (daysPastDue <= 60) return "D31_60";
  if (daysPastDue <= 90) return "D61_90";
  return "OVER_90";
}

export type OpenItem = {
  id: string;
  entityId: string;
  contact: { id: string; name: string };
  number: string;
  issueDate: Date;
  dueDate: Date;
  description: string;
  total: bigint;
  settled: bigint;
  open: bigint;
  daysPastDue: number;
  bucket: Bucket;
  opening: boolean;
  entryId: string | null;
  arApCode: string;
};

const DAY = 86_400_000;

/** Each entity's opening date (its first OPENING entry), for the entities given. */
export async function openingDates(db: Db | Tx, entityIds: string[]): Promise<Map<string, Date>> {
  if (!entityIds.length) return new Map();
  const rows = await db.journalEntry.groupBy({ by: ["entityId"], where: { entityId: { in: entityIds }, kind: "OPENING" }, _min: { date: true } });
  return new Map(rows.flatMap((r) => (r._min.date ? [[r.entityId, r._min.date] as const] : [])));
}

/**
 * When an invoice enters the subledger: its issue date, or — for a Saldo Awal item, whose balance the opening entry holds — the opening
 * date (never before its issue date). Aging still runs from its own due date.
 */
export function subledgerFrom(i: { entityId: string; issueDate: Date; opening: boolean }, openings: Map<string, Date>): Date {
  const opened = i.opening ? openings.get(i.entityId) : undefined;
  return opened && +opened > +i.issueDate ? opened : i.issueDate;
}

/** Every invoice of the direction in the subledger by `asOf`, with what was settled by then; `open` may be 0 (paid). */
export async function invoicesAt(db: Db, clientId: string, direction: InvoiceDirection, asOf: Date, entityIds?: string[]): Promise<OpenItem[]> {
  const found = await db.invoice.findMany({
    where: { clientId, direction, issueDate: { lte: asOf }, ...(entityIds ? { entityId: { in: entityIds } } : {}) },
    include: { contact: { select: { id: true, name: true } }, arApAccount: { select: { code: true } }, settlements: { select: { amount: true, bankTransaction: { select: { date: true } } } } },
    orderBy: [{ dueDate: "asc" }, { number: "asc" }],
  });
  const openings = await openingDates(db, [...new Set(found.filter((i) => i.opening).map((i) => i.entityId))]);
  const invoices = found.filter((i) => +subledgerFrom(i, openings) <= +asOf);
  return invoices.map((i) => {
    const settled = i.settlements.filter((s) => +s.bankTransaction.date <= +asOf).reduce((t, s) => t + s.amount, 0n);
    const daysPastDue = Math.floor((+asOf - +i.dueDate) / DAY);
    return {
      id: i.id,
      entityId: i.entityId,
      contact: i.contact,
      number: i.number,
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      description: i.description,
      total: i.total,
      settled,
      open: i.total - settled,
      daysPastDue,
      bucket: bucketOf(daysPastDue),
      opening: i.opening,
      entryId: i.entryId,
      arApCode: i.arApAccount.code,
    };
  });
}

export type AgingRow = { contact: { id: string; name: string }; buckets: Record<Bucket, bigint>; total: bigint; count: number };

/** Open amounts per contact and bucket, largest total first. */
export function agingByContact(items: OpenItem[]): AgingRow[] {
  const rows = new Map<string, AgingRow>();
  for (const i of items.filter((x) => x.open > 0n)) {
    const r = rows.get(i.contact.id) ?? { contact: i.contact, buckets: Object.fromEntries(BUCKETS.map((b) => [b, 0n])) as Record<Bucket, bigint>, total: 0n, count: 0 };
    r.buckets[i.bucket] += i.open;
    r.total += i.open;
    r.count++;
    rows.set(i.contact.id, r);
  }
  return [...rows.values()].sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : a.contact.name.localeCompare(b.contact.name)));
}

export type SubledgerComparison = { entityId: string; direction: InvoiceDirection; accounts: string[]; subledger: bigint; ledger: bigint; unsettledLines: number; equal: boolean };

/**
 * Per entity with invoices of the direction: Σ open items vs the GL balance of the receivable/payable accounts they use (receivable
 * as a debit balance, payable as a credit balance), and how many bank lines on those accounts are not (fully) settled — the usual
 * reason for a difference.
 */
export async function subledgerVsLedger(db: Db, clientId: string, direction: InvoiceDirection, asOf: Date, entityIds?: string[]): Promise<SubledgerComparison[]> {
  const items = await invoicesAt(db, clientId, direction, asOf, entityIds);
  const out: SubledgerComparison[] = [];
  for (const entityId of [...new Set(items.map((i) => i.entityId))]) {
    const mine = items.filter((i) => i.entityId === entityId);
    const codes = [...new Set(mine.map((i) => i.arApCode))].sort();
    const accounts = await db.account.findMany({ where: { clientId, code: { in: codes } }, select: { id: true } });
    const s = await db.journalLine.aggregate({ where: { entityId, accountId: { in: accounts.map((a) => a.id) }, date: { lte: asOf } }, _sum: { debit: true, credit: true } });
    const net = (s._sum.debit ?? 0n) - (s._sum.credit ?? 0n);
    const lines = await db.bankTransaction.findMany({
      where: { entityId, date: { lte: asOf }, accountCode: { in: codes }, status: { not: "NEEDS_REVIEW" } },
      select: { amount: true, settlements: { select: { amount: true } } },
    });
    const unsettledLines = lines.filter((t) => (t.amount < 0n ? -t.amount : t.amount) > t.settlements.reduce((u, x) => u + x.amount, 0n)).length;
    const subledger = mine.reduce((t, i) => t + i.open, 0n);
    const ledger = direction === "SALES" ? net : -net;
    out.push({ entityId, direction, accounts: codes, subledger, ledger, unsettledLines, equal: subledger === ledger });
  }
  return out;
}
