import type { Db } from "@/lib/db";
import type { ScheduleKind } from "@/lib/generated/prisma/enums";
import { ACCOUNT_CODES } from "@/lib/coa/template";
import { formatDate, periodBounds } from "@/lib/format";
import { scanLedger } from "@/lib/controls/anomaly";
import { installments } from "@/lib/adjust/schedules";

/**
 * Candidates for new adjustment schedules, read from the period's ledger (deterministic, cycle adjustment-schedules).
 * Shown as suggestions with a prefilled form; nothing is created until the accountant clicks, and they never block the
 * close. A candidate disappears once a schedule cites its source entry (accruals: once an accrual for that account starts
 * this month).
 */

export const DEFAULT_MONTHS: Record<ScheduleKind, number> = { DEPRECIATION: 48, AMORTIZATION: 12, ACCRUAL: 1 };
const DEPRECIATION_EXPENSE = "6180";
const ACCUMULATED_DEPRECIATION = "1219";
const ACCRUED_EXPENSES = "2150";
const DEFERRED_REVENUE = "2160";
const SERVICE_REVENUE = "4110";
const DEFERRED_NAME = /diterima di muka|unearned|deferred revenue/i;

export type Candidate = {
  key: string;
  kind: ScheduleKind;
  entity: { id: string; shortName: string; functionalCurrency: string };
  /** What the ledger shows, e.g. "Pembelian aset tetap 19 Agu 2026". */
  reason: string;
  memo: string;
  /** null = the accountant picks (the expense a prepayment is amortised into). */
  debitCode: string | null;
  creditCode: string;
  amount: bigint;
  months: number;
  startYear: number;
  startMonth: number;
  sourceEntryId: string | null;
};

function next(year: number, month: number) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export async function scheduleCandidates(db: Db, clientId: string, year: number, month: number): Promise<Candidate[]> {
  const { start, end } = periodBounds(year, month);
  const entities = await db.entity.findMany({ where: { clientId }, orderBy: { name: "asc" } });
  const codes = new Set((await db.account.findMany({ where: { clientId }, select: { code: true } })).map((a) => a.code));
  const nm = next(year, month);
  const out: Candidate[] = [];
  for (const e of entities) {
    const ent = { id: e.id, shortName: e.shortName, functionalCurrency: e.functionalCurrency };
    const scan = await scanLedger(db, clientId, e.id, year, month);
    const floor = scan.materiality ?? 1n;
    const lines = await db.journalLine.findMany({
      where: {
        entityId: e.id,
        date: { gte: start, lte: end },
        entry: { kind: { not: "OPENING" }, scheduleId: null },
        OR: [{ account: { fsLine: { in: ["ASET_TETAP", "BIAYA_DIBAYAR_DIMUKA"] } } }, { account: { code: DEFERRED_REVENUE } }, ...["diterima di muka", "unearned", "deferred revenue"].map((w) => ({ account: { type: "LIABILITAS" as const, name: { contains: w, mode: "insensitive" as const } } }))],
      },
      include: { account: true, entry: { select: { id: true, memo: true, date: true, bankTransaction: { select: { description: true } } } } },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });
    // One candidate per source entry and account, on the net movement of that entry.
    const groups = new Map<string, { line: (typeof lines)[number]; net: bigint }>();
    for (const l of lines) {
      const k = `${l.entryId}|${l.accountId}`;
      const g = groups.get(k) ?? { line: l, net: 0n };
      g.net += l.debit - l.credit;
      groups.set(k, g);
    }
    // A schedule made from an entry covers only the line it came from, so a compound entry's other lines stay proposed. Prepaid and
    // deferred-revenue schedules name that account; a depreciation schedule doesn't (6180/1219), so its memo identifies the line.
    const from = await db.adjustmentSchedule.findMany({ where: { entityId: e.id, sourceEntryId: { in: [...new Set(lines.map((l) => l.entryId))] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    // Depreciation schedules are matched to asset lines one to one (a schedule covers one line, even when two lines share an amount).
    const coveredAssets = new Set<string>();
    for (const entryId of new Set(lines.map((l) => l.entryId))) {
      const assets = [...groups.entries()].filter(([, g]) => g.line.entryId === entryId && g.line.account.fsLine === "ASET_TETAP");
      const pool = from.filter((s) => s.sourceEntryId === entryId && s.kind === "DEPRECIATION");
      // A schedule hides only the asset line it identifies, never one it merely might be: first by the account code its memo carries
      // (a schedule made from a candidate keeps "Penyusutan <code> <account> <date>", the code never cut off, whatever amount it was
      // given), then by the account name (longest first), then by its exact amount. A schedule that identifies no line hides none,
      // so at worst a suggestion stays visible.
      const words = (memo: string) => new Set(memo.toLowerCase().split(/\s+/));
      for (const s of pool) {
        const open = assets.filter(([k]) => !coveredAssets.has(k));
        const coded = open.filter(([, g]) => words(s.memo).has(g.line.account.code.toLowerCase()));
        const named = open.filter(([, g]) => s.memo.toLowerCase().includes(g.line.account.name.toLowerCase())).sort(([, x], [, y]) => y.line.account.name.length - x.line.account.name.length);
        const hit = coded[0] ?? named.find(([, g]) => g.net === s.amount) ?? named[0] ?? open.find(([, g]) => g.net === s.amount);
        if (hit) coveredAssets.add(hit[0]);
      }
    }
    // A prepayment amortises by crediting its account, deferred revenue by debiting its account: only a schedule with the account
    // on that side covers the line (one on the other side would grow the balance, not release it).
    const covered = (k: string, l: (typeof lines)[number]) =>
      l.account.fsLine === "ASET_TETAP"
        ? coveredAssets.has(k)
        : from.some((s) => s.sourceEntryId === l.entryId && (l.account.fsLine === "BIAYA_DIBAYAR_DIMUKA" ? s.creditAccountId === l.accountId : s.debitAccountId === l.accountId));
    for (const [k, { line: l, net }] of groups) {
      if (covered(k, l)) continue;
      const when = formatDate(l.entry.date);
      // What happened, in the source's words: the bank description for a reviewed bank line, else the journal memo.
      const what = (l.entry.bankTransaction?.description ?? l.memo ?? l.entry.memo).replace(/^Reklasifikasi:\s*/i, "").slice(0, 90);
      const label = `${l.account.name} ${when}`;
      const base = { entity: ent, sourceEntryId: l.entry.id, startYear: nm.year, startMonth: nm.month };
      // The depreciation memo leads with the account code: it survives the 80-character cut and identifies the line (see covered).
      if (l.account.fsLine === "ASET_TETAP" && net >= floor && codes.has(DEPRECIATION_EXPENSE) && codes.has(ACCUMULATED_DEPRECIATION)) {
        out.push({ ...base, key: `DEPRECIATION:${e.id}:${l.entry.id}:${l.account.code}`, kind: "DEPRECIATION", reason: `Pembelian ${l.account.code} ${l.account.name} ${when}: ${what}`, memo: `Penyusutan ${l.account.code} ${label}`.slice(0, 80), debitCode: DEPRECIATION_EXPENSE, creditCode: ACCUMULATED_DEPRECIATION, amount: net, months: DEFAULT_MONTHS.DEPRECIATION });
      } else if (l.account.fsLine === "BIAYA_DIBAYAR_DIMUKA" && net >= floor) {
        out.push({ ...base, key: `AMORTIZATION:${e.id}:${l.entry.id}:${l.account.code}`, kind: "AMORTIZATION", reason: `Dibayar di muka ke ${l.account.code} ${when}: ${what}`, memo: `Amortisasi ${label}`.slice(0, 80), debitCode: null, creditCode: l.account.code, amount: net, months: DEFAULT_MONTHS.AMORTIZATION });
      } else if (l.account.type === "LIABILITAS" && (l.account.code === DEFERRED_REVENUE || DEFERRED_NAME.test(l.account.name)) && -net >= floor && codes.has(SERVICE_REVENUE)) {
        out.push({ ...base, key: `AMORTIZATION:${e.id}:${l.entry.id}:${l.account.code}`, kind: "AMORTIZATION", reason: `Diterima di muka ke ${l.account.code} ${when}: ${what}`, memo: `Pengakuan ${label}`.slice(0, 80), debitCode: l.account.code, creditCode: SERVICE_REVENUE, amount: -net, months: DEFAULT_MONTHS.AMORTIZATION });
      }
    }

    // A recurring cost missing this month: movement in each of the 3 baseline months, none now → accrue the average.
    if (scan.baseline.length === 3 && codes.has(ACCRUED_EXPENSES)) {
      // Accounts a running schedule already covers, and accruals already started for this month.
      // Only schedules with an installment in this very month cover the account (not finished or stopped ones).
      const scheduled = new Set(
        (await db.adjustmentSchedule.findMany({ where: { entityId: e.id, stoppedAt: null } }))
          .filter((s) => installments(s).some((i) => !i.reversal && i.year === year && i.month === month))
          .map((s) => s.debitAccountId),
      );
      const accounts = await db.account.findMany({ where: { clientId, type: "BEBAN", code: { notIn: [ACCOUNT_CODES.ROUNDING, ACCOUNT_CODES.FX_GAIN_LOSS] } } });
      for (const a of accounts) {
        const series = scan.series.get(a.id);
        if (!series || scheduled.has(a.id)) continue;
        const prior = series.slice(0, 3);
        if (series[3] !== 0n || prior.some((v) => v <= 0n)) continue;
        const average = prior.reduce((s, v) => s + v, 0n) / 3n;
        if (average < floor) continue;
        out.push({ key: `ACCRUAL:${e.id}:${a.code}`, kind: "ACCRUAL", entity: ent, reason: `${a.code} ${a.name} tercatat tiap bulan (${scan.baseline.join(", ")}), bulan ini belum`, memo: `Akrual ${a.name}`.slice(0, 80), debitCode: a.code, creditCode: ACCRUED_EXPENSES, amount: average, months: 1, startYear: year, startMonth: month, sourceEntryId: null });
      }
    }
  }
  return out;
}
