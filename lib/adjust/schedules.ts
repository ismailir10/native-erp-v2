import type { Db, Tx } from "@/lib/db";
import type { AdjustmentSchedule } from "@/lib/generated/prisma/client";
import type { ScheduleKind } from "@/lib/generated/prisma/enums";
import { LedgerError, postJournal } from "@/lib/ledger/post";
import { dateOnly, formatPeriod, periodBounds } from "@/lib/format";
import { parseMoney } from "@/lib/money";

/**
 * Adjustment schedules (accounting-rules 5a): depreciation, amortisation and accruals as a recurring adjusting entry.
 * Installments are computed, proposed at read time for their month, and posted only by the accountant's click through
 * postJournal(); each posted entry carries `scheduleId` + `installment` (unique, so a double click posts once).
 * A schedule is never edited: stop it and create a new one.
 */

export const KIND_LABEL: Record<ScheduleKind, string> = { DEPRECIATION: "Penyusutan", AMORTIZATION: "Amortisasi", ACCRUAL: "Akrual" };
export const MAX_MONTHS = 600;

export type Installment = { k: number; year: number; month: number; date: Date; debitAccountId: string; creditAccountId: string; amount: bigint; reversal: boolean };

function shift(year: number, month: number, by: number) {
  const i = year * 12 + (month - 1) + by;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
}

/** Exact split: ⌊total / months⌋ each, the last takes the remainder; a reversing schedule adds one swapped installment. */
export function installments(s: Pick<AdjustmentSchedule, "amount" | "months" | "startYear" | "startMonth" | "reverse" | "debitAccountId" | "creditAccountId">): Installment[] {
  const n = BigInt(s.months);
  const base = s.amount / n;
  const out: Installment[] = [];
  for (let k = 1; k <= s.months; k++) {
    const { year, month } = shift(s.startYear, s.startMonth, k - 1);
    const amount = k === s.months ? s.amount - base * (n - 1n) : base;
    out.push({ k, year, month, date: periodBounds(year, month).end, debitAccountId: s.debitAccountId, creditAccountId: s.creditAccountId, amount, reversal: false });
  }
  if (s.reverse) {
    const { year, month } = shift(s.startYear, s.startMonth, s.months);
    out.push({ k: s.months + 1, year, month, date: dateOnly(year, month, 1), debitAccountId: s.creditAccountId, creditAccountId: s.debitAccountId, amount: s.amount, reversal: true });
  }
  return out;
}

export const installmentMemo = (s: Pick<AdjustmentSchedule, "memo" | "months">, i: Pick<Installment, "k" | "reversal">) =>
  i.reversal ? `Pembalikan: ${s.memo}` : `${s.memo} (${i.k}/${s.months})`;

export type ScheduleInput = {
  clientId: string;
  entityId: string;
  kind: ScheduleKind;
  memo: string;
  debitCode: string;
  creditCode: string;
  /** Typed in major units of the entity's functional currency (parsed here, rule 6). */
  amount: string;
  months: number;
  startYear: number;
  startMonth: number;
  sourceEntryId?: string | null;
  actorId?: string | null;
};

/** Serialises schedule creation with closing a month of the client (rule 5a): taken inside a transaction by both. */
export const closeLock = (tx: Tx, clientId: string) => tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`close:${clientId}`}, 0))::text`;

/**
 * Ids of the client's schedules with an installment (or reversal) due in or before the month, the ones its `sched:` control can
 * show (an overdue installment stays proposed); a close compares them before and after its controls.
 */
export async function schedulesDueBy(db: Db | Tx, clientId: string, year: number, month: number) {
  const upTo = year * 12 + month;
  const all = await db.adjustmentSchedule.findMany({ where: { clientId }, orderBy: { id: "asc" } });
  return all.filter((s) => installments(s).some((i) => i.year * 12 + i.month <= upTo)).map((s) => s.id);
}

export async function createSchedule(db: Db, input: ScheduleInput) {
  const entity = await db.entity.findFirst({ where: { id: input.entityId, clientId: input.clientId } });
  if (!entity) throw new LedgerError("Pilih entitas.");
  const memo = input.memo.trim();
  if (!memo) throw new LedgerError("Isi keterangan jadwal.");
  const accounts = await db.account.findMany({ where: { clientId: input.clientId, code: { in: [input.debitCode, input.creditCode] } } });
  const debit = accounts.find((a) => a.code === input.debitCode);
  const credit = accounts.find((a) => a.code === input.creditCode);
  if (!debit || !credit) throw new LedgerError("Pilih akun debit dan kredit dari bagan akun klien.");
  if (debit.id === credit.id) throw new LedgerError("Akun debit dan kredit harus berbeda.");
  if ([debit, credit].some((a) => a.isBank || a.isSuspense || a.isClearing)) throw new LedgerError("Jadwal penyesuaian tidak memakai akun bank, kliring atau 1999.");
  const amount = parseMoney(input.amount, entity.functionalCurrency);
  if (amount <= 0n) throw new LedgerError("Nominal harus lebih dari nol.");
  // An accrual is one month, reversed on the 1st of the next (assumption 3 of the cycle).
  const accrual = input.kind === "ACCRUAL";
  const months = accrual ? 1 : Math.trunc(input.months);
  if (!(months >= 1 && months <= MAX_MONTHS)) throw new LedgerError(`Jumlah bulan 1–${MAX_MONTHS}.`);
  // Every installment must carry an amount; a zero one could never post (postJournal needs two non-zero lines).
  if (amount < BigInt(months)) throw new LedgerError(`Nominal terlalu kecil untuk dibagi ${months} bulan.`);
  if (!(input.startMonth >= 1 && input.startMonth <= 12) || !Number.isInteger(input.startYear)) throw new LedgerError("Bulan mulai tidak valid.");
  if (input.sourceEntryId) {
    const src = await db.journalEntry.findFirst({ where: { id: input.sourceEntryId, entityId: entity.id } });
    if (!src) throw new LedgerError("Jurnal sumber tidak termasuk entitas ini.");
  }
  // Every installment (and an accrual's reversal) must still be postable: one in a locked month could never post, and later months
  // would close without it (rule 5a). Checked under the client's close lock, so a close running now can't slip in between.
  const planned = installments({ amount, months, startYear: input.startYear, startMonth: input.startMonth, reverse: accrual, debitAccountId: debit.id, creditAccountId: credit.id });
  return db.$transaction(async (tx) => {
    await closeLock(tx, input.clientId);
    const locked = await tx.period.findFirst({
      where: { clientId: input.clientId, status: "LOCKED", OR: planned.map((i) => ({ year: i.year, month: i.month })) },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    });
    if (locked) throw new LedgerError(`${formatPeriod(locked.year, locked.month)} sudah dikunci, jadi cicilan di bulan itu tidak bisa dicatat. Buka kunci bulan itu atau mulai jadwal setelahnya.`);
    return tx.adjustmentSchedule.create({
      data: {
        firmId: entity.firmId,
        clientId: input.clientId,
        entityId: entity.id,
        kind: input.kind,
        memo,
        debitAccountId: debit.id,
        creditAccountId: credit.id,
        amount,
        months,
        startYear: input.startYear,
        startMonth: input.startMonth,
        reverse: accrual,
        sourceEntryId: input.sourceEntryId ?? null,
        createdById: input.actorId ?? null,
      },
    });
  });
}

export type Proposal = { schedule: AdjustmentSchedule & { entity: { id: string; shortName: string; functionalCurrency: string }; debitAccount: { code: string; name: string }; creditAccount: { code: string; name: string } }; installment: Installment; memo: string };

/**
 * Installments due in or before the period and not posted yet (an overdue one stays visible until posted, so a later month can't
 * close without it), for running schedules. One in a locked month can't post any more and is left out. Nothing is stored.
 */
export async function dueProposals(db: Db, clientId: string, year: number, month: number, entityId?: string): Promise<Proposal[]> {
  const locked = new Set((await db.period.findMany({ where: { clientId, status: "LOCKED" }, select: { year: true, month: true } })).map((p) => p.year * 12 + p.month));
  const upTo = year * 12 + month;
  // A stopped accrual still owes the reversal of an accrual it already posted; a stopped schedule proposes nothing else.
  const schedules = await db.adjustmentSchedule.findMany({
    where: { clientId, OR: [{ stoppedAt: null }, { reverse: true }], ...(entityId ? { entityId } : {}) },
    include: { entity: { select: { id: true, shortName: true, functionalCurrency: true } }, debitAccount: { select: { code: true, name: true } }, creditAccount: { select: { code: true, name: true } }, entries: { select: { installment: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const out: Proposal[] = [];
  for (const s of schedules) {
    const posted = new Set(s.entries.map((e) => e.installment));
    for (const i of installments(s)) {
      // A reversal only follows the accrual it reverses: never propose it while that installment is unposted.
      if (i.reversal && !posted.has(s.months)) continue;
      if (s.stoppedAt && !i.reversal) continue;
      const at = i.year * 12 + i.month;
      if (at <= upTo && !locked.has(at) && !posted.has(i.k)) out.push({ schedule: s, installment: i, memo: installmentMemo(s, i) });
    }
  }
  return out;
}

const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

/** The accountant's click: one ADJUSTMENT entry for one installment. */
export async function postInstallment(db: Db, input: { clientId: string; scheduleId: string; k: number; actorId?: string | null }) {
  const s = await db.adjustmentSchedule.findFirst({ where: { id: input.scheduleId, clientId: input.clientId } });
  if (!s) throw new LedgerError("Jadwal tidak ditemukan.");
  const i = installments(s).find((x) => x.k === input.k);
  if (!i) throw new LedgerError("Angsuran tidak ada di jadwal ini.");
  if (i.reversal && !(await db.journalEntry.findFirst({ where: { scheduleId: s.id, installment: s.months }, select: { id: true } }))) {
    throw new LedgerError(`Catat dulu ${installmentMemo(s, { k: s.months, reversal: false })} sebelum pembaliknya.`);
  }
  try {
    return await db.$transaction(async (tx) => {
      // Lock the schedule and read its stop inside the posting transaction: a stop racing this click either commits first (and is
      // seen here) or waits until this installment is recorded. The reversal of a posted accrual is still owed after a stop.
      const [row] = await tx.$queryRaw<{ stoppedAt: Date | null }[]>`SELECT "stoppedAt" FROM "AdjustmentSchedule" WHERE id = ${s.id} FOR UPDATE`;
      if (row?.stoppedAt && !i.reversal) throw new LedgerError("Jadwal ini sudah dihentikan.");
      return postJournal(tx, {
        entityId: s.entityId,
        date: i.date,
        kind: "ADJUSTMENT",
        memo: installmentMemo(s, i),
        scheduleId: s.id,
        installment: i.k,
        actorId: input.actorId,
        lines: [
          { accountId: i.debitAccountId, debit: i.amount },
          { accountId: i.creditAccountId, credit: i.amount },
        ],
      });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new LedgerError(`${installmentMemo(s, i)} sudah dicatat.`);
    throw e;
  }
}

/** Post every due installment of the period (one entry each). Stops at the first error; earlier ones stay posted. */
export async function postAllDue(db: Db, input: { clientId: string; year: number; month: number; entityId?: string; actorId?: string | null }) {
  const due = await dueProposals(db, input.clientId, input.year, input.month, input.entityId);
  if (!due.length) throw new LedgerError(`Tidak ada jurnal terjadwal untuk ${formatPeriod(input.year, input.month)}.`);
  for (const p of due) await postInstallment(db, { clientId: input.clientId, scheduleId: p.schedule.id, k: p.installment.k, actorId: input.actorId });
  return due.length;
}

export async function stopSchedule(db: Db, input: { clientId: string; scheduleId: string }) {
  const s = await db.adjustmentSchedule.findFirst({ where: { id: input.scheduleId, clientId: input.clientId } });
  if (!s) throw new LedgerError("Jadwal tidak ditemukan.");
  if (s.stoppedAt) return s;
  // Conditional update: takes the row lock a posting click holds, so the two serialize (see postInstallment).
  await db.adjustmentSchedule.updateMany({ where: { id: s.id, stoppedAt: null }, data: { stoppedAt: new Date() } });
  return db.adjustmentSchedule.findUniqueOrThrow({ where: { id: s.id } });
}

/** Schedules of a client with progress: installments posted, amount posted and remaining (reversals excluded). */
export async function listSchedules(db: Db, clientId: string) {
  const schedules = await db.adjustmentSchedule.findMany({
    where: { clientId },
    include: { entity: { select: { id: true, shortName: true, functionalCurrency: true } }, debitAccount: { select: { code: true, name: true } }, creditAccount: { select: { code: true, name: true } }, sourceEntry: { select: { memo: true, date: true, bankTransaction: { select: { description: true } } } }, entries: { select: { installment: true, lines: { select: { debit: true } } } } },
    orderBy: [{ stoppedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }, { id: "asc" }],
  });
  return schedules.map((s) => {
    const forward = s.entries.filter((e) => e.installment !== null && e.installment <= s.months);
    const postedAmount = forward.reduce((t, e) => t + e.lines.reduce((u, l) => u + l.debit, 0n), 0n);
    const last = installments(s).filter((i) => !i.reversal).at(-1)!;
    return { ...s, postedCount: forward.length, postedAmount, remaining: s.amount - postedAmount, ends: { year: last.year, month: last.month } };
  });
}
