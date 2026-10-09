import { financialYear, fiscalEndMonth, monthsIntoYear, priorYearEnd } from "@/lib/fiscal";
import type { Db, Tx } from "@/lib/db";
import type { Employee } from "@/lib/generated/prisma/client";
import { LedgerError, postJournal } from "@/lib/ledger/post";
import { closeLock } from "@/lib/adjust/schedules";
import { templateAccounts } from "@/lib/coa/ensure";
import { ACCOUNT_CODES } from "@/lib/coa/template";
import { formatDate, periodBounds } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { qxOf } from "@/lib/benefits/census";
import { interestCost, valueEmployee, type Assumptions, type EmployeeValue } from "@/lib/benefits/puc";

/**
 * The PSAK 219 valuation of an entity at a month-end and the journal that books it (accounting-rules 5g). Computed at read time from the
 * census, the assumptions and the firm's mortality table; nothing but the journal (and its BenefitPosting) is stored.
 */

const C = ACCOUNT_CODES;
type Reader = Db | Tx;

const activeAt = (e: Pick<Employee, "hireDate" | "leftOn">, at: Date) => +e.hireDate <= +at && (!e.leftOn || +e.leftOn > +at);

export type ValuedEmployee = EmployeeValue & { id: string; name: string; employeeNo: string | null; sex: Employee["sex"]; wage: bigint; hireDate: Date; newHire: boolean };

export type BenefitLine = { code: string; amount: bigint };

export type Valuation = {
  entityId: string;
  at: Date;
  /** Why nothing can be valued, if so. */
  blocker: string | null;
  configured: boolean;
  tableName: string | null;
  employees: ValuedEmployee[];
  dbo: bigint;
  serviceCost: bigint;
  interestCost: bigint;
  sensitivity: { discountUp: bigint; discountDown: bigint; salaryUp: bigint; salaryDown: bigint } | null;
  /** The valuation at the previous financial-year end (employees employed then, today's wages). */
  opening: { at: Date; dbo: bigint; serviceCost: bigint; interestCost: bigint };
  /** 6105 year to date: (service + interest cost of the opening valuation) × months of the financial year so far ÷ 12 + the obligation of employees hired since. */
  expenseTarget: bigint;
  ledger: { liability: bigint; liabilityOpening: bigint; expenseYtd: bigint };
  /** First year in Buku: the opening obligation not yet in 2310 goes to Saldo Laba. */
  firstYear: boolean;
  lines: BenefitLine[];
  later: Date | null;
};

async function balance(db: Reader, clientId: string, entityId: string, code: string, from: Date | null, to: Date) {
  const acc = await db.account.findFirst({ where: { clientId, code }, select: { id: true } });
  if (!acc) return 0n;
  const s = await db.journalLine.aggregate({ where: { entityId, accountId: acc.id, date: { ...(from ? { gte: from } : {}), lte: to } }, _sum: { debit: true, credit: true } });
  return (s._sum.debit ?? 0n) - (s._sum.credit ?? 0n);
}

function value(employees: Employee[], a: Assumptions, at: Date) {
  return employees.filter((e) => activeAt(e, at)).map((e) => ({ e, v: valueEmployee(e, a, at) }));
}
const sum = <T>(xs: T[], f: (x: T) => bigint) => xs.reduce((t, x) => t + f(x), 0n);

export async function valuation(db: Reader, clientId: string, entityId: string, year: number, month: number): Promise<Valuation> {
  const at = periodBounds(year, month).end;
  // The client's financial year (lib/fiscal.ts): the valuation opens at the previous year end and expense counts from the year's start.
  const endMonth = await fiscalEndMonth(db, clientId);
  const yearStart = financialYear(endMonth, year, month).start;
  const openingAt = priorYearEnd(endMonth, year, month);
  const elapsed = monthsIntoYear(endMonth, year, month);
  const setting = await db.benefitSetting.findUnique({ where: { entityId }, include: { mortalityTable: true } });
  const employees = await db.employee.findMany({ where: { clientId, entityId }, orderBy: [{ hireDate: "asc" }, { name: "asc" }] });
  const later = (await db.benefitPosting.findFirst({ where: { entityId, entry: { date: { gt: at } } }, include: { entry: { select: { date: true } } }, orderBy: { entry: { date: "desc" } } }))?.entry.date ?? null;
  const ledger = {
    liability: -(await balance(db, clientId, entityId, C.BENEFIT_LIABILITY, null, at)),
    liabilityOpening: -(await balance(db, clientId, entityId, C.BENEFIT_LIABILITY, null, openingAt)),
    expenseYtd: await balance(db, clientId, entityId, C.BENEFIT_EXPENSE, yearStart, at),
  };
  const empty = { at: openingAt, dbo: 0n, serviceCost: 0n, interestCost: 0n };
  const base = { entityId, at, configured: !!setting, tableName: setting?.mortalityTable?.name ?? null, ledger, later };
  const blocker = !setting ? "Isi asumsi aktuaria entitas ini dulu." : !setting.mortalityTable ? "Pilih tabel mortalita (unggah TMI IV milik kantor dulu)." : null;
  if (!setting || !setting.mortalityTable) {
    return { ...base, blocker, employees: [], dbo: 0n, serviceCost: 0n, interestCost: 0n, sensitivity: null, opening: empty, expenseTarget: 0n, firstYear: false, lines: [] };
  }

  const a: Assumptions = {
    discount: setting.discountBp / 10_000,
    salary: setting.salaryBp / 10_000,
    retirementAge: setting.retirementAge,
    disability: setting.disabilityBp / 10_000,
    resign: setting.resignBp / 10_000,
    resignFlatUntil: setting.resignFlatUntil,
    resignZeroAge: setting.resignZeroAge,
    qx: qxOf(setting.mortalityTable),
  };
  const now = value(employees, a, at);
  const dbo = sum(now, (x) => x.v.dbo);
  const serviceCost = sum(now, (x) => x.v.serviceCost);
  const total = (b: Assumptions) => sum(value(employees, b, at), (x) => x.v.dbo);
  const sensitivity = { discountUp: total({ ...a, discount: a.discount + 0.01 }), discountDown: total({ ...a, discount: Math.max(0, a.discount - 0.01) }), salaryUp: total({ ...a, salary: a.salary + 0.01 }), salaryDown: total({ ...a, salary: Math.max(0, a.salary - 0.01) }) };

  const open = value(employees, a, openingAt);
  const opening = { at: openingAt, dbo: sum(open, (x) => x.v.dbo), serviceCost: sum(open, (x) => x.v.serviceCost), interestCost: 0n };
  opening.interestCost = interestCost(opening.dbo, opening.serviceCost, setting.discountBp);
  const hired = now.filter((x) => +x.e.hireDate > +openingAt);
  const annual = opening.serviceCost + opening.interestCost;
  const expenseTarget = (annual * BigInt(elapsed) * 2n + 12n) / 24n + sum(hired, (x) => x.v.dbo);

  // First year in Buku: no benefit journal before this year. The opening obligation not yet in 2310 belongs to prior periods.
  const earlier = await db.benefitPosting.count({ where: { entityId, entry: { date: { lte: openingAt } } } });
  const firstYear = earlier === 0;
  let gap = 0n;
  if (firstYear) {
    const postings = await db.benefitPosting.findMany({ where: { entityId, entry: { date: { gte: yearStart, lte: at } } }, include: { entry: { include: { lines: { include: { account: { select: { code: true } } } } } } } });
    const booked = postings.flatMap((p) => p.entry.lines).filter((l) => l.account.code === C.RETAINED).reduce((t, l) => t + l.debit - l.credit, 0n);
    gap = opening.dbo - ledger.liabilityOpening - booked;
  }
  const liabilityDelta = dbo - ledger.liability;
  const expenseDelta = expenseTarget - ledger.expenseYtd;
  const lines: BenefitLine[] = [
    { code: C.BENEFIT_EXPENSE, amount: expenseDelta },
    { code: C.RETAINED, amount: gap },
    { code: C.BENEFIT_REMEASUREMENT, amount: liabilityDelta - expenseDelta - gap },
    { code: C.BENEFIT_LIABILITY, amount: -liabilityDelta },
  ].filter((l) => l.amount !== 0n);

  return {
    ...base,
    blocker: null,
    employees: now.map(({ e, v }) => ({ ...v, id: e.id, name: e.name, employeeNo: e.employeeNo, sex: e.sex, wage: e.wage, hireDate: e.hireDate, newHire: +e.hireDate > +openingAt })),
    dbo,
    serviceCost,
    interestCost: interestCost(dbo, serviceCost, setting.discountBp),
    sensitivity,
    opening,
    expenseTarget,
    firstYear,
    lines,
  };
}

const same = (a: BenefitLine[], b: BenefitLine[]) => a.length === b.length && a.every((l, i) => l.code === b[i].code && l.amount === b[i].amount);

/** The valuation journal by the accountant's click, dated the month-end; serialised per entity and with the close. */
export async function postBenefits(db: Db, input: { clientId: string; entityId: string; year: number; month: number; actorId?: string | null }) {
  const entity = await db.entity.findFirst({ where: { id: input.entityId, clientId: input.clientId } });
  if (!entity) throw new LedgerError("Pilih entitas.");
  const v = await valuation(db, input.clientId, entity.id, input.year, input.month);
  if (v.blocker) throw new LedgerError(v.blocker);
  if (v.later) throw new LedgerError(`Imbalan kerja sudah dijurnal per ${formatDate(v.later)}. Catat perubahan di bulan itu atau sesudahnya.`);
  if (!v.lines.length) throw new LedgerError("Tidak ada selisih yang perlu dijurnal.");
  return db.$transaction(async (tx) => {
    await closeLock(tx, input.clientId);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`eb:${entity.id}`}, 0))::text`;
    const again = await valuation(tx, input.clientId, entity.id, input.year, input.month);
    if (!same(again.lines, v.lines) || again.later) throw new LedgerError("Valuasi imbalan kerja berubah sementara itu. Muat ulang halaman lalu coba lagi.");
    const ids = await templateAccounts(tx, input.clientId, v.lines.map((l) => l.code));
    const entry = await postJournal(tx, {
      entityId: entity.id,
      date: v.at,
      kind: "ADJUSTMENT",
      memo: `Imbalan kerja PSAK 219 per ${formatDate(v.at)}: liabilitas ${formatMoney(v.dbo, entity.functionalCurrency)}`,
      lines: v.lines.map((l) => (l.amount > 0n ? { accountId: ids.get(l.code)!, debit: l.amount } : { accountId: ids.get(l.code)!, credit: -l.amount })),
      actorId: input.actorId,
    });
    await tx.benefitPosting.create({ data: { firmId: entity.firmId, entityId: entity.id, year: input.year, month: input.month, entryId: entry.id } });
    return entry;
  });
}
