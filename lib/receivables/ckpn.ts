import type { Db, Tx } from "@/lib/db";
import type { CkpnMethod } from "@/lib/generated/prisma/enums";
import { ACCOUNT_CODES } from "@/lib/coa/template";
import { templateAccounts } from "@/lib/coa/ensure";
import { closeLock } from "@/lib/adjust/schedules";
import { LedgerError, postJournal } from "@/lib/ledger/post";
import { formatDate, formatPeriod, percentToBp, periodBounds } from "@/lib/format";
import { BUCKETS, BUCKET_LABEL, bucketOf, openingDates, subledgerFrom, type Bucket } from "@/lib/receivables/aging";

/**
 * CKPN piutang usaha (PSAK 109 simplified approach, accounting-rules 5e): a provision matrix on the aging of the entity's sales invoices.
 * Loss rates come from roll rates of Buku's own month-end aging (or are typed by the accountant), the allowance is Σ open amount per
 * bucket × loss rate × a forward-looking factor, and the journal brings 1135 to it against 6185. Rates are integers: settings in basis
 * points, computed rates in parts per million; amounts stay bigint.
 */

export const PPM = 1_000_000n;
const BP_TO_PPM = 100n;
const DAY = 86_400_000;

export type CkpnSettingValues = {
  method: CkpnMethod;
  historyMonths: number;
  currentBp: number;
  d1to30Bp: number;
  d31to60Bp: number;
  d61to90Bp: number;
  lastBucketBp: number;
  forwardBp: number;
};

export const DEFAULT_SETTING: CkpnSettingValues = { method: "ROLL_RATE", historyMonths: 12, currentBp: 0, d1to30Bp: 0, d31to60Bp: 0, d61to90Bp: 0, lastBucketBp: 10_000, forwardBp: 10_000 };

/** An invoice as the matrix needs it: when it enters the subledger (`issueDate`; a Saldo Awal item: the opening date), when it falls due, its total, and its settlements by date. */
export type LedgerInvoice = { id: string; issueDate: Date; dueDate: Date; total: bigint; settlements: { date: Date; amount: bigint }[] };

const openAt = (i: LedgerInvoice, asOf: Date) => i.total - i.settlements.filter((s) => +s.date <= +asOf).reduce((t, s) => t + s.amount, 0n);
const bucketAt = (i: LedgerInvoice, asOf: Date) => bucketOf(Math.floor((+asOf - +i.dueDate) / DAY));
const halfUp = (num: bigint, den: bigint) => (num * 2n + den) / (2n * den);

/** Open amount per bucket at a date (invoices issued by then). */
export function agingAt(invoices: LedgerInvoice[], asOf: Date): Record<Bucket, bigint> {
  const out = Object.fromEntries(BUCKETS.map((b) => [b, 0n])) as Record<Bucket, bigint>;
  for (const i of invoices) {
    if (+i.issueDate > +asOf) continue;
    const open = openAt(i, asOf);
    if (open > 0n) out[bucketAt(i, asOf)] += open;
  }
  return out;
}

export type RollRate = { from: Bucket; ppm: bigint | null; samples: number };

/**
 * Roll rates between consecutive month-ends, invoice by invoice: of what was open in bucket b at month t and, by its due date, has aged
 * beyond b at month t+1, the share still open then (capped at 100 %). Invoices still in b at t+1 had no chance to roll and don't count.
 * Averaged over the months where b had such an amount; no month → null. The last bucket has no roll rate (its loss rate is set).
 */
export function rollRates(invoices: LedgerInvoice[], monthEnds: Date[]): RollRate[] {
  return BUCKETS.slice(0, -1).map((from, b) => {
    let sum = 0n;
    let samples = 0;
    for (let t = 0; t + 1 < monthEnds.length; t++) {
      const [now, next] = [monthEnds[t], monthEnds[t + 1]];
      let base = 0n;
      let rolled = 0n;
      for (const i of invoices) {
        if (+i.issueDate > +now || bucketAt(i, now) !== from || BUCKETS.indexOf(bucketAt(i, next)) <= b) continue;
        const open = openAt(i, now);
        if (open <= 0n) continue;
        base += open;
        const later = openAt(i, next);
        rolled += later < 0n ? 0n : later > open ? open : later;
      }
      if (base === 0n) continue;
      sum += halfUp(rolled * PPM, base);
      samples++;
    }
    return { from, ppm: samples ? halfUp(sum, BigInt(samples)) : null, samples };
  });
}

/**
 * Loss rate per bucket: the last bucket's is set; each earlier bucket's is its roll rate × the next bucket's loss rate. A zero roll rate
 * gives zero whatever follows; an unknown one (no history) leaves the bucket, and every earlier bucket that depends on it, unknown.
 */
export function lossRates(rolls: (bigint | null)[], lastBucketPpm: bigint): (bigint | null)[] {
  const out: (bigint | null)[] = new Array(BUCKETS.length).fill(null);
  out[BUCKETS.length - 1] = lastBucketPpm;
  for (let b = BUCKETS.length - 2; b >= 0; b--) {
    const roll = rolls[b];
    const next = out[b + 1];
    out[b] = roll === 0n ? 0n : roll === null || next === null ? null : halfUp(roll * next, PPM);
  }
  return out;
}

export function manualRates(s: CkpnSettingValues): bigint[] {
  return [s.currentBp, s.d1to30Bp, s.d31to60Bp, s.d61to90Bp, s.lastBucketBp].map((bp) => BigInt(bp) * BP_TO_PPM);
}

/** Allowance per bucket = open × loss rate × forward-looking factor, rounded half up; null where the loss rate is unknown. */
export function allowance(open: Record<Bucket, bigint>, rates: (bigint | null)[], forwardBp: number): (bigint | null)[] {
  return BUCKETS.map((b, i) => {
    const rate = rates[i];
    if (rate === null) return open[b] > 0n ? null : 0n;
    return halfUp(open[b] * rate * BigInt(forwardBp), PPM * 10_000n);
  });
}

/** Month-ends from `historyMonths` months before the period end up to it, oldest first. */
export function monthEnds(year: number, month: number, historyMonths: number): Date[] {
  const out: Date[] = [];
  for (let k = historyMonths; k >= 0; k--) {
    const idx = year * 12 + (month - 1) - k;
    out.push(periodBounds(Math.floor(idx / 12), (idx % 12) + 1).end);
  }
  return out;
}

export type CkpnRow = { bucket: Bucket; open: bigint; roll: bigint | null; samples: number; rate: bigint | null; amount: bigint | null };

export type Ckpn = {
  entityId: string;
  through: Date;
  setting: CkpnSettingValues & { saved: boolean; effective: { year: number; month: number } | null };
  rows: CkpnRow[];
  /** Month-ends the roll rates used (those with sales invoices issued by then). */
  snapshots: Date[];
  /** Why the matrix can't be completed, if it can't. */
  blocker: string | null;
  total: bigint | null;
  /** Credit balance of 1135 at the period end (GL). */
  balance: bigint;
  /** total − balance: > 0 increases the allowance (Dr 6185 / Cr 1135), < 0 releases it. */
  difference: bigint | null;
  /** A CKPN journal line on 1135 dated after the period end, if any: the position is booked there. */
  later: Date | null;
};

/** Credit balance of the allowance account at a date (0 when the client has no 1135). */
export async function allowanceBalance(db: Db | Tx, clientId: string, entityId: string, asOf: Date) {
  const acc = await db.account.findFirst({ where: { clientId, code: ACCOUNT_CODES.ALLOWANCE }, select: { id: true } });
  if (!acc) return 0n;
  const s = await db.journalLine.aggregate({ where: { entityId, accountId: acc.id, date: { lte: asOf } }, _sum: { debit: true, credit: true } });
  return (s._sum.credit ?? 0n) - (s._sum.debit ?? 0n);
}

export async function allowanceAfter(db: Db | Tx, clientId: string, entityId: string, asOf: Date) {
  const acc = await db.account.findFirst({ where: { clientId, code: ACCOUNT_CODES.ALLOWANCE }, select: { id: true } });
  if (!acc) return null;
  const l = await db.journalLine.findFirst({ where: { entityId, accountId: acc.id, date: { gt: asOf } }, orderBy: { date: "desc" }, select: { date: true } });
  return l?.date ?? null;
}

/** The entity's CKPN setting in force for year-month: the latest version effective by then (null before the first). */
export function settingAt(db: Db | Tx, entityId: string, year: number, month: number) {
  return db.ckpnSetting.findFirst({
    where: { entityId, OR: [{ effectiveYear: { lt: year } }, { effectiveYear: year, effectiveMonth: { lte: month } }] },
    orderBy: [{ effectiveYear: "desc" }, { effectiveMonth: "desc" }],
  });
}

/** The matrix, the allowance and the journal difference for an entity at a month-end. */
export async function ckpn(db: Db | Tx, clientId: string, entityId: string, year: number, month: number): Promise<Ckpn> {
  const saved = await settingAt(db, entityId, year, month);
  const setting: CkpnSettingValues = saved ?? DEFAULT_SETTING;
  const through = periodBounds(year, month).end;
  const rows = await db.invoice.findMany({
    where: { clientId, entityId, direction: "SALES", issueDate: { lte: through } },
    select: { id: true, entityId: true, issueDate: true, opening: true, dueDate: true, total: true, settlements: { select: { amount: true, bankTransaction: { select: { date: true } } } } },
  });
  const openings = await openingDates(db, rows.some((r) => r.opening) ? [entityId] : []);
  const invoices: LedgerInvoice[] = rows.map((r) => ({
    id: r.id,
    issueDate: subledgerFrom(r, openings),
    dueDate: r.dueDate,
    total: r.total,
    settlements: r.settlements.map((s) => ({ date: s.bankTransaction.date, amount: s.amount })),
  }));
  const open = agingAt(invoices, through);

  const first = invoices.reduce<Date | null>((d, i) => (!d || +i.issueDate < +d ? i.issueDate : d), null);
  const snapshots = first ? monthEnds(year, month, setting.historyMonths).filter((d) => +d >= +periodBounds(first.getUTCFullYear(), first.getUTCMonth() + 1).end) : [];
  let rolls: RollRate[] = BUCKETS.slice(0, -1).map((from) => ({ from, ppm: null, samples: 0 }));
  let rates: (bigint | null)[];
  if (setting.method === "MANUAL") rates = manualRates(setting);
  else {
    if (snapshots.length >= 2) rolls = rollRates(invoices, snapshots);
    rates = lossRates(rolls.map((r) => r.ppm), BigInt(setting.lastBucketBp) * BP_TO_PPM);
  }
  const amounts = allowance(open, rates, setting.forwardBp);
  // A bucket with an open amount and no loss rate blocks the proposal; buckets without an open amount don't matter.
  const missing = BUCKETS.filter((_, i) => amounts[i] === null);
  const blocker = !missing.length
    ? null
    : snapshots.length < 2
      ? "Roll rate butuh piutang di minimal dua akhir bulan. Pakai tarif manual dulu."
      : `Belum ada riwayat roll rate untuk ${missing.map((b) => BUCKET_LABEL[b].toLowerCase()).join(", ")}. Pakai tarif manual atau tambah jumlah bulan riwayat.`;
  const total = blocker ? null : amounts.reduce<bigint>((t, a) => t + (a ?? 0n), 0n);
  const balance = await allowanceBalance(db, clientId, entityId, through);
  return {
    entityId,
    through,
    setting: { ...setting, saved: !!saved, effective: saved ? { year: saved.effectiveYear, month: saved.effectiveMonth } : null },
    rows: BUCKETS.map((bucket, i) => ({ bucket, open: open[bucket], roll: i < rolls.length ? rolls[i].ppm : null, samples: i < rolls.length ? rolls[i].samples : 0, rate: rates[i], amount: blocker ? null : amounts[i] })),
    snapshots: setting.method === "ROLL_RATE" ? snapshots : [],
    blocker,
    total,
    balance,
    difference: total === null ? null : total - balance,
    later: await allowanceAfter(db, clientId, entityId, through),
  };
}

/** `year`/`month`: the first month the saved setting applies to (the page's month); earlier months keep the version they had. */
export type CkpnSettingInput = { clientId: string; entityId: string; year: number; month: number; method: CkpnMethod; historyMonths: number; forward: string; lastBucket: string; manual: [string, string, string, string] };

export async function saveCkpnSetting(db: Db, input: CkpnSettingInput) {
  const entity = await db.entity.findFirst({ where: { id: input.entityId, clientId: input.clientId } });
  if (!entity) throw new LedgerError("Pilih entitas.");
  if (input.method !== "ROLL_RATE" && input.method !== "MANUAL") throw new LedgerError("Pilih metode CKPN.");
  if (!(Number.isInteger(input.historyMonths) && input.historyMonths >= 2 && input.historyMonths <= 36)) throw new LedgerError("Riwayat roll rate 2–36 bulan.");
  const rate = (text: string, label: string, max = 10_000) => {
    const bp = percentToBp(text);
    if (bp === null || bp > max) throw new LedgerError(`${label}: isi persen 0–${max / 100}.`);
    return bp;
  };
  const forwardBp = rate(input.forward, "Faktor forward-looking", 30_000);
  const lastBucketBp = rate(input.lastBucket, "Tarif kerugian > 90 hari");
  const [currentBp, d1to30Bp, d31to60Bp, d61to90Bp] =
    input.method === "MANUAL" ? input.manual.map((m, i) => rate(m, `Tarif kerugian ${BUCKET_LABEL[BUCKETS[i]].toLowerCase()}`)) : [0, 0, 0, 0];
  const data = { method: input.method, historyMonths: input.historyMonths, forwardBp, lastBucketBp, currentBp, d1to30Bp, d31to60Bp, d61to90Bp };
  if (!(Number.isInteger(input.year) && input.year >= 2000 && input.year <= 2100 && Number.isInteger(input.month) && input.month >= 1 && input.month <= 12)) throw new LedgerError("Periode berlaku tidak valid.");
  const key = { entityId: entity.id, effectiveYear: input.year, effectiveMonth: input.month };
  // A new version governs its month and every later one until the next version: none of those may be closed. Serialised with the close.
  return db.$transaction(async (tx) => {
    await closeLock(tx, input.clientId);
    const next = await tx.ckpnSetting.findFirst({ where: { entityId: entity.id, OR: [{ effectiveYear: { gt: input.year } }, { effectiveYear: input.year, effectiveMonth: { gt: input.month } }] }, orderBy: [{ effectiveYear: "asc" }, { effectiveMonth: "asc" }] });
    const idx = (y: number, m: number) => y * 12 + m;
    const locked = (await tx.period.findMany({ where: { clientId: input.clientId, status: "LOCKED" }, select: { year: true, month: true } }))
      .filter((p) => idx(p.year, p.month) >= idx(input.year, input.month) && (!next || idx(p.year, p.month) < idx(next.effectiveYear, next.effectiveMonth)))
      .sort((a, b) => idx(a.year, a.month) - idx(b.year, b.month))[0];
    if (locked) throw new LedgerError(`${formatPeriod(locked.year, locked.month)} sudah dikunci dan memakai pengaturan CKPN ini. Simpan perubahan untuk bulan sesudah bulan terkunci terakhir, atau buka kuncinya dulu.`);
    return tx.ckpnSetting.upsert({ where: { entityId_effectiveYear_effectiveMonth: key }, update: data, create: { ...data, ...key, firmId: entity.firmId } });
  });
}

/**
 * The CKPN journal by the accountant's click: one ADJUSTMENT entry dated the period end bringing 1135 to the computed allowance against
 * 6185 (an increase Dr 6185 / Cr 1135, a release the reverse). Serialised per entity and with the close; refuses when the matrix changed
 * meanwhile or the allowance was already moved after the period end.
 */
export async function postCkpn(db: Db, input: { clientId: string; entityId: string; year: number; month: number; actorId?: string | null }) {
  const entity = await db.entity.findFirst({ where: { id: input.entityId, clientId: input.clientId } });
  if (!entity) throw new LedgerError("Pilih entitas.");
  const c = await ckpn(db, input.clientId, entity.id, input.year, input.month);
  if (!c.setting.saved) throw new LedgerError("Simpan pengaturan CKPN entitas ini dulu.");
  if (c.later) throw new LedgerError(`Cadangan kerugian sudah dijurnal per ${formatDate(c.later)}. Catat perubahan di bulan itu atau sesudahnya.`);
  if (c.blocker || c.difference === null) throw new LedgerError(c.blocker ?? "CKPN belum bisa dihitung.");
  if (c.difference === 0n) throw new LedgerError("Tidak ada selisih yang perlu dijurnal.");

  return db.$transaction(async (tx) => {
    await closeLock(tx, input.clientId);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ckpn:${entity.id}`}, 0))::text`;
    const now = await ckpn(tx, input.clientId, entity.id, input.year, input.month);
    if (now.difference !== c.difference || now.later) throw new LedgerError("CKPN berubah sementara itu. Muat ulang halaman lalu coba lagi.");
    const ids = await templateAccounts(tx, input.clientId, [ACCOUNT_CODES.ALLOWANCE, ACCOUNT_CODES.IMPAIRMENT_EXPENSE]);
    const [allowanceId, expenseId] = [ids.get(ACCOUNT_CODES.ALLOWANCE)!, ids.get(ACCOUNT_CODES.IMPAIRMENT_EXPENSE)!];
    const d = c.difference!;
    return postJournal(tx, {
      entityId: entity.id,
      date: c.through,
      kind: "ADJUSTMENT",
      memo: `CKPN piutang usaha per ${formatDate(c.through)} (PSAK 109): ${d > 0n ? "penambahan" : "pemulihan"} cadangan`,
      lines: d > 0n ? [{ accountId: expenseId, debit: d }, { accountId: allowanceId, credit: d }] : [{ accountId: allowanceId, debit: -d }, { accountId: expenseId, credit: -d }],
      actorId: input.actorId,
    });
  });
}

/** Serialisable CKPN card (bigint as string, rates as percent text). */
export type CkpnView = {
  entityId: string;
  entity: string;
  currency: string;
  setting: { method: CkpnMethod; historyMonths: number; forward: string; lastBucket: string; manual: [string, string, string, string]; saved: boolean };
  /** "Januari 2026" when the setting in force was saved for another month than the one shown. */
  effectiveFrom: string | null;
  rows: { bucket: Bucket; label: string; open: string; roll: string | null; samples: number; rate: string | null; amount: string | null }[];
  snapshots: { first: string; last: string; count: number } | null;
  blocker: string | null;
  total: string | null;
  balance: string;
  difference: string | null;
  later: string | null;
};

const bpText = (bp: number) => (bp / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 });
const ppmText = (ppm: bigint) => `${(Number(ppm) / 10_000).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

export function ckpnView(c: Ckpn, entity: { shortName: string; functionalCurrency: string }): CkpnView {
  const s = c.setting;
  const month = (d: Date) => d.toLocaleDateString("id-ID", { month: "short", year: "numeric", timeZone: "UTC" });
  return {
    entityId: c.entityId,
    entity: entity.shortName,
    currency: entity.functionalCurrency,
    setting: { method: s.method, historyMonths: s.historyMonths, forward: bpText(s.forwardBp), lastBucket: bpText(s.lastBucketBp), manual: [bpText(s.currentBp), bpText(s.d1to30Bp), bpText(s.d31to60Bp), bpText(s.d61to90Bp)], saved: s.saved },
    effectiveFrom: s.effective && !(s.effective.year === c.through.getUTCFullYear() && s.effective.month === c.through.getUTCMonth() + 1) ? (s.effective.year === 2000 && s.effective.month === 1 ? "awal" : formatPeriod(s.effective.year, s.effective.month)) : null,
    rows: c.rows.map((r) => ({ bucket: r.bucket, label: BUCKET_LABEL[r.bucket], open: r.open.toString(), roll: r.roll === null ? null : ppmText(r.roll), samples: r.samples, rate: r.rate === null ? null : ppmText(r.rate), amount: r.amount === null ? null : r.amount.toString() })),
    snapshots: c.snapshots.length ? { first: month(c.snapshots[0]), last: month(c.snapshots[c.snapshots.length - 1]), count: c.snapshots.length } : null,
    blocker: c.blocker,
    total: c.total === null ? null : c.total.toString(),
    balance: c.balance.toString(),
    difference: c.difference === null ? null : c.difference.toString(),
    later: c.later ? formatDate(c.later) : null,
  };
}
