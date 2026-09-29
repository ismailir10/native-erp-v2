import type { Db, Tx } from "@/lib/db";
import type { Lease } from "@/lib/generated/prisma/client";
import type { LeaseTiming } from "@/lib/generated/prisma/enums";
import { LedgerError, postJournal, type PostLine } from "@/lib/ledger/post";
import { closeLock } from "@/lib/adjust/schedules";
import { templateAccounts } from "@/lib/coa/ensure";
import { ACCOUNT_CODES } from "@/lib/coa/template";
import { dateOnly, formatPeriod, percentToBp, periodBounds } from "@/lib/format";
import { parseMoney } from "@/lib/money";
import { leaseSchedule, monthsElapsed, positionAt, type LeaseSchedule, type LeaseTerms } from "@/lib/leases/schedule";

/**
 * Lease register (PSAK 116, accounting-rules 5f). The contract is stored; the schedule is computed (lib/leases/schedule.ts). Journals,
 * by the accountant's click: the commencement on registration, one entry per lease-month (depreciation, interest, reclass of the
 * non-current decrease), and a reversal when a lease registered by mistake is cancelled. Payments come from the bank statement (2170).
 */

export const INTERVALS = [1, 3, 6, 12] as const;
const C = ACCOUNT_CODES;

export const terms = (l: Pick<Lease, "startYear" | "startMonth" | "months" | "payment" | "intervalMonths" | "timing" | "rateBp">): LeaseTerms => ({
  startYear: l.startYear,
  startMonth: l.startMonth,
  months: l.months,
  payment: l.payment,
  intervalMonths: l.intervalMonths,
  timing: l.timing,
  rateBp: l.rateBp,
});

export type LeaseInput = {
  clientId: string;
  entityId: string;
  name: string;
  lessor: string;
  /** YYYY-MM: month 1 of the term. */
  start: string;
  months: number;
  /** Each payment, typed in major units of the entity's currency (rule 6). */
  payment: string;
  intervalMonths: number;
  timing: LeaseTiming;
  /** Annual discount rate in percent ("9,5"). */
  rate: string;
  actorId?: string | null;
};

const lock = (tx: Tx, entityId: string) => tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lease:${entityId}`}, 0))::text`;

export async function createLease(db: Db, input: LeaseInput) {
  const entity = await db.entity.findFirst({ where: { id: input.entityId, clientId: input.clientId } });
  if (!entity) throw new LedgerError("Pilih entitas.");
  const name = input.name.trim();
  const lessor = input.lessor.trim();
  if (!name) throw new LedgerError("Isi nama sewa (mis. Sewa kantor Jl. Sudirman).");
  if (!lessor) throw new LedgerError("Isi nama pihak yang menyewakan.");
  const m = input.start.match(/^(\d{4})-(\d{2})$/);
  const [startYear, startMonth] = m ? [Number(m[1]), Number(m[2])] : [0, 0];
  if (!m || startMonth < 1 || startMonth > 12 || startYear < 2000 || startYear > 2100) throw new LedgerError("Bulan mulai sewa tidak valid.");
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > 600) throw new LedgerError("Masa sewa 13–600 bulan.");
  if (input.months <= 12) throw new LedgerError("Sewa jangka pendek (≤ 12 bulan) dibebankan langsung sebagai beban sewa (pengecualian PSAK 116); tidak perlu didaftarkan.");
  if (!(INTERVALS as readonly number[]).includes(input.intervalMonths)) throw new LedgerError("Pilih interval pembayaran.");
  if (input.months % input.intervalMonths !== 0) throw new LedgerError(`Masa sewa harus kelipatan ${input.intervalMonths} bulan (interval pembayaran).`);
  if (input.timing !== "ADVANCE" && input.timing !== "ARREARS") throw new LedgerError("Pilih waktu pembayaran: di muka atau di akhir.");
  const payment = parseMoney(input.payment, entity.functionalCurrency);
  if (payment <= 0n) throw new LedgerError("Nominal pembayaran harus lebih dari nol.");
  const rateBp = percentToBp(input.rate);
  if (rateBp === null || rateBp > 10_000) throw new LedgerError("Suku bunga diskonto: isi persen per tahun 0–100 (suku bunga pinjaman inkremental).");
  const contract = { startYear, startMonth, months: input.months, payment, intervalMonths: input.intervalMonths, timing: input.timing, rateBp };
  const s = leaseSchedule(contract);

  return db.$transaction(async (tx) => {
    await closeLock(tx, input.clientId);
    await lock(tx, entity.id);
    const ids = await templateAccounts(tx, input.clientId, [C.ROU_ASSET, C.LEASE_CURRENT, C.LEASE_NON_CURRENT]);
    const lease = await tx.lease.create({ data: { firmId: entity.firmId, clientId: input.clientId, entityId: entity.id, name, lessor, ...contract, createdById: input.actorId ?? null } });
    const entry = await postJournal(tx, {
      entityId: entity.id,
      date: dateOnly(startYear, startMonth, 1),
      kind: "ADJUSTMENT",
      memo: `Pengakuan awal sewa ${name} · ${lessor} (PSAK 116)`,
      lines: [
        { accountId: ids.get(C.ROU_ASSET)!, debit: s.rou },
        { accountId: ids.get(C.LEASE_CURRENT)!, credit: s.current },
        { accountId: ids.get(C.LEASE_NON_CURRENT)!, credit: s.nonCurrent },
      ],
      actorId: input.actorId,
    });
    return tx.lease.update({ where: { id: lease.id }, data: { entryId: entry.id } });
  });
}

/** Lines of month k: depreciation, interest, and the move of the non-current decrease to current. */
export function monthLines(s: LeaseSchedule, k: number, ids: Map<string, string>): PostLine[] {
  const row = s.months[k - 1];
  const before = k === 1 ? s.nonCurrent : s.months[k - 2].nonCurrent;
  const pair = (amount: bigint, debit: string, credit: string): PostLine[] =>
    amount >= 0n
      ? [{ accountId: ids.get(debit)!, debit: amount }, { accountId: ids.get(credit)!, credit: amount }]
      : [{ accountId: ids.get(credit)!, debit: -amount }, { accountId: ids.get(debit)!, credit: -amount }];
  return [...pair(row.depreciation, C.ROU_DEPRECIATION, C.ROU_ACCUMULATED), ...pair(row.interest, C.LEASE_INTEREST, C.LEASE_CURRENT), ...pair(before - row.nonCurrent, C.LEASE_NON_CURRENT, C.LEASE_CURRENT)];
}

/** Months (k) of active leases of the entity ended by year-month and not yet journalled. */
export async function leaseMonthsDue(db: Db | Tx, clientId: string, entityId: string, year: number, month: number) {
  const leases = await db.lease.findMany({ where: { clientId, entityId, cancelEntryId: null }, include: { postings: { select: { month: true } } }, orderBy: [{ startYear: "asc" }, { startMonth: "asc" }, { name: "asc" }] });
  return leases.flatMap((l) => {
    const done = new Set(l.postings.map((p) => p.month));
    return Array.from({ length: monthsElapsed(l, year, month) }, (_, i) => i + 1).filter((k) => !done.has(k)).map((k) => ({ lease: l, k }));
  });
}

/** Post every due lease-month of the entity up to year-month, oldest first, in one transaction. */
export async function postLeaseMonths(db: Db, input: { clientId: string; entityId: string; year: number; month: number; actorId?: string | null }) {
  const entity = await db.entity.findFirst({ where: { id: input.entityId, clientId: input.clientId } });
  if (!entity) throw new LedgerError("Pilih entitas.");
  const due = await leaseMonthsDue(db, input.clientId, entity.id, input.year, input.month);
  if (!due.length) throw new LedgerError("Tidak ada jurnal sewa yang jatuh tempo.");
  return db.$transaction(async (tx) => {
    await closeLock(tx, input.clientId);
    await lock(tx, entity.id);
    const now = await leaseMonthsDue(tx, input.clientId, entity.id, input.year, input.month);
    if (now.length !== due.length) throw new LedgerError("Jurnal sewa berubah sementara itu. Muat ulang halaman lalu coba lagi.");
    const ids = await templateAccounts(tx, input.clientId, [C.ROU_DEPRECIATION, C.ROU_ACCUMULATED, C.LEASE_INTEREST, C.LEASE_CURRENT, C.LEASE_NON_CURRENT]);
    const ordered = [...now].sort((a, b) => a.k + a.lease.startYear * 12 + a.lease.startMonth - (b.k + b.lease.startYear * 12 + b.lease.startMonth));
    for (const { lease, k } of ordered) {
      const s = leaseSchedule(terms(lease));
      const row = s.months[k - 1];
      const period = await tx.period.findUnique({ where: { clientId_year_month: { clientId: input.clientId, year: row.year, month: row.month } } });
      if (period?.status === "LOCKED") throw new LedgerError(`${formatPeriod(row.year, row.month)} sudah dikunci; jurnal sewa ${lease.name} bulan itu tidak bisa dicatat. Buka kunci bulan itu dulu.`);
      const entry = await postJournal(tx, { entityId: entity.id, date: row.date, kind: "ADJUSTMENT", memo: `Sewa ${lease.name} (${k}/${lease.months}): penyusutan hak guna, bunga, reklasifikasi`, lines: monthLines(s, k, ids), actorId: input.actorId });
      await tx.leasePosting.create({ data: { firmId: entity.firmId, leaseId: lease.id, month: k, entryId: entry.id } });
    }
    return ordered.length;
  });
}

/** Cancel a lease registered by mistake: reverse its commencement entry (append-only ledger); no monthly journal may exist. */
export async function cancelLease(db: Db, input: { clientId: string; leaseId: string; actorId?: string | null }) {
  const lease = await db.lease.findFirst({ where: { id: input.leaseId, clientId: input.clientId }, include: { postings: { select: { id: true } }, entry: { include: { lines: true } } } });
  if (!lease) throw new LedgerError("Sewa tidak ditemukan.");
  if (lease.cancelEntryId) throw new LedgerError("Sewa ini sudah dibatalkan.");
  if (lease.postings.length) throw new LedgerError("Jurnal bulanan sewa ini sudah dicatat; sewa tidak bisa dibatalkan.");
  return db.$transaction(async (tx) => {
    await closeLock(tx, input.clientId);
    await lock(tx, lease.entityId);
    if (await tx.leasePosting.count({ where: { leaseId: lease.id } })) throw new LedgerError("Jurnal bulanan sewa ini sudah dicatat; sewa tidak bisa dibatalkan.");
    const e = lease.entry!;
    const entry = await postJournal(tx, {
      entityId: lease.entityId,
      date: e.date,
      kind: "ADJUSTMENT",
      memo: `Pembatalan: ${e.memo}`,
      lines: e.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit })),
      actorId: input.actorId,
    });
    return tx.lease.update({ where: { id: lease.id }, data: { cancelEntryId: entry.id } });
  });
}

export type LeaseTotals = { rou: bigint; accumulated: bigint; liability: bigint; current: bigint; nonCurrent: bigint };
const credit = async (db: Db | Tx, clientId: string, entityId: string, codes: string[], asOf: Date) => {
  const accounts = await db.account.findMany({ where: { clientId, code: { in: codes } }, select: { id: true } });
  const s = await db.journalLine.aggregate({ where: { entityId, accountId: { in: accounts.map((a) => a.id) }, date: { lte: asOf } }, _sum: { debit: true, credit: true } });
  return (s._sum.credit ?? 0n) - (s._sum.debit ?? 0n);
};

/**
 * The register at a month-end (active leases, every due month assumed journalled and every payment made on its date) against the GL of
 * 1230, 1239 and 2170 + 2400, and the months still to journal; null when the entity has no active lease started by then.
 */
export async function leasesVsLedger(db: Db | Tx, clientId: string, entityId: string, year: number, month: number) {
  const leases = await db.lease.findMany({ where: { clientId, entityId, cancelEntryId: null } });
  const started = leases.filter((l) => l.startYear * 12 + l.startMonth <= year * 12 + month);
  if (!started.length) return null;
  const register: LeaseTotals = { rou: 0n, accumulated: 0n, liability: 0n, current: 0n, nonCurrent: 0n };
  for (const l of started) {
    const t = terms(l);
    const p = positionAt(t, leaseSchedule(t), year, month);
    register.rou += p.rou;
    register.accumulated += p.accumulated;
    register.liability += p.liability;
    register.current += p.current;
    register.nonCurrent += p.nonCurrent;
  }
  const asOf = periodBounds(year, month).end;
  const ledger = {
    rou: -(await credit(db, clientId, entityId, [C.ROU_ASSET], asOf)),
    accumulated: await credit(db, clientId, entityId, [C.ROU_ACCUMULATED], asOf),
    liability: await credit(db, clientId, entityId, [C.LEASE_CURRENT, C.LEASE_NON_CURRENT], asOf),
  };
  const due = (await leaseMonthsDue(db, clientId, entityId, year, month)).length;
  return { register, ledger, due, equal: due === 0 && register.rou === ledger.rou && register.accumulated === ledger.accumulated && register.liability === ledger.liability };
}
