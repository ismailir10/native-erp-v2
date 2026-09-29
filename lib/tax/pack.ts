import type { Db, Tx } from "@/lib/db";
import type { CorrectionDirection, CorrectionKind, TaxCreditType, TaxPostingKind, TaxRegime } from "@/lib/generated/prisma/enums";
import { incomeStatement } from "@/lib/reports/ledger";
import { assetRegister } from "@/lib/assets/register";
import { ACCOUNT_CODES } from "@/lib/coa/template";
import { dateOnly, periodBounds } from "@/lib/format";
import { corporateTax, deferredTax, roundDownThousands, settlement, type CorporateTax, type Settlement } from "@/lib/tax/compute";

/**
 * The tax pack of one entity and fiscal year, through a month (accounting-rules 5d): commercial profit → koreksi fiskal → PKP → PPh
 * badan → credits → PPh 29 / 28A, deferred tax, and the journals that would bring the books to that position. Read from the GL and the
 * accountant's records at request time; nothing computed is stored.
 */

export const NON_DEDUCTIBLE = /sumbangan|donasi|denda|sanksi|bunga penagihan|natura|kenikmatan|entertain|jamuan|representasi/i;
/** Bank interest and jasa giro: income already taxed finally under PPh 4(2), so it leaves fiscal profit. */
export const FINAL_TAXED_INCOME = /bunga|jasa giro|deposito/i;

export type Correction = {
  key: string;
  label: string;
  direction: CorrectionDirection;
  kind: CorrectionKind;
  amount: bigint;
  /** Where it comes from: the asset register, an account's ledger, or the accountant's own row. */
  source: { type: "ASSETS" } | { type: "ACCOUNT"; code: string; name: string } | { type: "MANUAL"; id: string; code: string | null };
};
export type Suggestion = { key: string; code: string; name: string; amount: bigint };
export type Credit = { key: string; type: TaxCreditType | "PPH_25"; label: string; date: Date; amount: bigint; accountCode: string; source: { type: "BANK"; bankTransactionId: string } | { type: "MANUAL"; id: string } };
export type ProposalLine = { code: string; amount: bigint };

export type TaxPack = {
  entity: { id: string; name: string; shortName: string; kind: string; functionalCurrency: string };
  year: number;
  month: number;
  through: Date;
  applicable: boolean;
  regime: TaxRegime;
  taxYearId: string | null;
  profitBeforeTax: bigint;
  turnover: bigint;
  corrections: Correction[];
  suggestions: Suggestion[];
  positive: bigint;
  negative: bigint;
  fiscalProfit: bigint;
  tax: CorporateTax;
  credits: Credit[];
  settlement: Settlement | null;
  deferred: { temporaryDifference: bigint; amount: bigint } | null;
  /** Signed lines (debit +, credit −) still to post to reach the computed position, per kind; empty = nothing to post. */
  proposals: Record<TaxPostingKind, ProposalLine[]>;
};

type Reader = Db | Tx;

/** A PPh badan pack applies to companies (not individuals) keeping IDR books. */
export const packApplies = (e: { kind: string; functionalCurrency: string }) => e.kind !== "PERORANGAN" && e.functionalCurrency === "IDR";

export async function taxPack(db: Db, clientId: string, entityId: string, year: number, month: number): Promise<TaxPack | null> {
  const entity = await db.entity.findFirst({ where: { id: entityId, clientId }, select: { id: true, name: true, shortName: true, kind: true, functionalCurrency: true } });
  if (!entity) return null;
  const through = periodBounds(year, month).end;
  const from = dateOnly(year, 1, 1);
  const taxYear = await db.taxYear.findUnique({ where: { entityId_year: { entityId, year } }, include: { corrections: { include: { account: true }, orderBy: { createdAt: "asc" } }, credits: { include: { account: true }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] } } });
  const regime: TaxRegime = taxYear?.regime ?? "NORMAL";
  const scope = { clientId, entityIds: [entityId] };
  const is = await incomeStatement(db, scope, from, through);
  const profitBeforeTax = is.totals.profitBeforeTax;
  const turnover = is.totals.revenue;

  // ---- koreksi fiskal ----
  const corrections: Correction[] = [];
  const assets = await assetRegister(db, clientId, year, month, [entityId]);
  const depreciationDiff = assets.reduce((t, r) => t + (r.difference ?? 0n), 0n);
  if (depreciationDiff !== 0n) {
    corrections.push({ key: "auto:depreciation", label: "Selisih penyusutan komersial dan fiskal", direction: depreciationDiff > 0n ? "POSITIVE" : "NEGATIVE", kind: "TEMPORARY", amount: depreciationDiff < 0n ? -depreciationDiff : depreciationDiff, source: { type: "ASSETS" } });
  }
  // P&L accounts with their year-to-date amount as income (+) or expense (+): the statement negates other expenses (BEBAN_LAIN).
  const income = [...is.revenue, ...is.other.filter((i) => i.fsLine === "PENDAPATAN_LAIN")].flatMap((i) => i.accounts.map((a) => ({ ...a, fsLine: i.fsLine })));
  const expenses = [...is.cogs, ...is.opex, ...is.other.filter((i) => i.fsLine === "BEBAN_LAIN").map((i) => ({ ...i, accounts: i.accounts.map((a) => ({ ...a, amount: -a.amount })) }))].flatMap((i) => i.accounts);
  for (const a of income.filter((x) => x.fsLine === "PENDAPATAN_LAIN" && FINAL_TAXED_INCOME.test(x.name) && x.amount > 0n)) {
    corrections.push({ key: `auto:final:${a.code}`, label: `Penghasilan yang dikenai PPh final: ${a.name}`, direction: "NEGATIVE", kind: "PERMANENT", amount: a.amount, source: { type: "ACCOUNT", code: a.code, name: a.name } });
  }
  for (const c of taxYear?.corrections ?? []) {
    // An accepted suggestion follows its account's year-to-date expense; a typed correction keeps its amount.
    const live = c.suggestion && c.account ? (expenses.find((x) => x.code === c.account!.code)?.amount ?? 0n) : null;
    // Kept at zero when the account has no expense this year, so the accountant still sees (and can remove) it.
    const amount = live !== null && live < 0n ? 0n : (live ?? c.amount);
    corrections.push({ key: `manual:${c.id}`, label: c.description, direction: c.direction, kind: c.kind, amount, source: { type: "MANUAL", id: c.id, code: c.account?.code ?? null } });
  }
  const accepted = new Set((taxYear?.corrections ?? []).flatMap((c) => (c.suggestion ? [c.suggestion] : [])));
  const dismissed = new Set(taxYear?.dismissedSuggestions ?? []);
  const suggestions: Suggestion[] = expenses
    .filter((x) => NON_DEDUCTIBLE.test(x.name) && x.amount > 0n)
    .map((x) => ({ key: `nd:${x.code}`, code: x.code, name: x.name, amount: x.amount }))
    .filter((s) => !accepted.has(s.key) && !dismissed.has(s.key));

  const final = regime === "FINAL_UMKM";
  const positive = final ? 0n : corrections.filter((c) => c.direction === "POSITIVE").reduce((t, c) => t + c.amount, 0n);
  const negative = final ? 0n : corrections.filter((c) => c.direction === "NEGATIVE").reduce((t, c) => t + c.amount, 0n);
  const fiscalProfit = profitBeforeTax + positive - negative;
  const tax = corporateTax({ regime, pkp: roundDownThousands(fiscalProfit), turnover });

  // ---- kredit pajak ----
  const instalments = await db.bankTransaction.findMany({ where: { entityId, taxTag: "PPH_25", direction: "OUT", date: { gte: from, lte: through }, status: { not: "NEEDS_REVIEW" } }, orderBy: [{ date: "asc" }, { rowNumber: "asc" }] });
  const credits: Credit[] = [
    ...instalments.map((t) => ({ key: `bank:${t.id}`, type: "PPH_25" as const, label: t.description, date: t.date, amount: -t.amount, accountCode: t.accountCode ?? "", source: { type: "BANK" as const, bankTransactionId: t.id } })),
    ...(taxYear?.credits ?? []).filter((c) => +c.date <= +through).map((c) => ({ key: `manual:${c.id}`, type: c.type, label: c.reference, date: c.date, amount: c.amount, accountCode: c.account.code, source: { type: "MANUAL" as const, id: c.id } })),
  ];
  const sum = (xs: Credit[]) => xs.reduce((t, c) => t + c.amount, 0n);
  const settled = final
    ? null
    : settlement({ due: tax.due, instalments: sum(credits.filter((c) => c.type === "PPH_25")), withheld: sum(credits.filter((c) => c.type === "PPH_22" || c.type === "PPH_23" || c.type === "PPH_24")), other: sum(credits.filter((c) => c.type === "OTHER")) });

  // ---- pajak tangguhan (fixed-asset register only) ----
  const fiscalValue = assets.reduce((t, r) => t + (r.fiscalBookValue ?? 0n), 0n);
  const bookValue = assets.reduce((t, r) => t + r.bookValue, 0n);
  // Under the final regime there is no fiscal profit, so no temporary difference to account for.
  const deferred = assets.length && entity.functionalCurrency === "IDR" && !final ? { temporaryDifference: fiscalValue - bookValue, amount: deferredTax(fiscalValue - bookValue) } : null;

  const applicable = packApplies(entity);
  const proposals: Record<TaxPostingKind, ProposalLine[]> = { CURRENT: [], DEFERRED: [] };
  if (applicable && settled) {
    const target = currentTarget(tax.due, credits, settled.balance);
    proposals.CURRENT = diff(target, await postedLines(db, entityId, "CURRENT", year));
  }
  if (applicable && deferred) {
    proposals.DEFERRED = deferredDiff(deferred.amount, await postedLines(db, entityId, "DEFERRED", year, true));
  }
  return { entity, year, month, through, applicable, regime, taxYearId: taxYear?.id ?? null, profitBeforeTax, turnover, corrections, suggestions, positive, negative, fiscalProfit, tax, credits, settlement: settled, deferred, proposals };
}

/**
 * The current-tax position: the expense equals the tax due (less credits already expensed on 8100, which the expense already holds), each
 * credit leaves the account it sits on, and the balance is PPh 29 payable (2146) or overpaid (1181). Signed: debit +, credit −; sums to 0.
 */
export function currentTarget(due: bigint, credits: { amount: bigint; accountCode: string }[], balance: bigint): Map<string, bigint> {
  const t = new Map<string, bigint>();
  const add = (code: string, v: bigint) => t.set(code, (t.get(code) ?? 0n) + v);
  add(ACCOUNT_CODES.CURRENT_TAX, due);
  for (const c of credits) {
    if (c.accountCode === ACCOUNT_CODES.CURRENT_TAX) add(ACCOUNT_CODES.CURRENT_TAX, -c.amount);
    else add(c.accountCode, -c.amount);
  }
  if (balance > 0n) add(ACCOUNT_CODES.TAX_PAYABLE_29, -balance);
  if (balance < 0n) add(ACCOUNT_CODES.TAX_OVERPAID, -balance);
  return t;
}

/** Lines booked so far by the entity's tax postings of a kind: of that year, or — for deferred balances — of every year up to it. */
export async function postedLines(db: Reader, entityId: string, kind: TaxPostingKind, year: number, cumulative = false): Promise<Map<string, bigint>> {
  const postings = await db.taxPosting.findMany({
    where: { kind, taxYear: { entityId, ...(cumulative ? { year: { lte: year } } : { year }) } },
    include: { taxYear: { select: { year: true } }, entry: { include: { lines: { include: { account: { select: { code: true } } } } } } },
  });
  const out = new Map<string, bigint>();
  for (const p of postings) {
    for (const l of p.entry.lines) {
      // Cumulative (deferred): balance-sheet accounts over all years, the expense only for this year.
      if (cumulative && p.taxYear.year !== year && l.account.code === ACCOUNT_CODES.DEFERRED_TAX) continue;
      out.set(l.account.code, (out.get(l.account.code) ?? 0n) + l.debit - l.credit);
    }
  }
  return out;
}

export function diff(target: Map<string, bigint>, posted: Map<string, bigint>): ProposalLine[] {
  const codes = [...new Set([...target.keys(), ...posted.keys()])].sort();
  return codes.map((code) => ({ code, amount: (target.get(code) ?? 0n) - (posted.get(code) ?? 0n) })).filter((l) => l.amount !== 0n);
}

/** Deferred tax: move 1270 / 2320 to the computed balance; the change goes to 8110. */
export function deferredDiff(amount: bigint, posted: Map<string, bigint>): ProposalLine[] {
  const asset = posted.get(ACCOUNT_CODES.DEFERRED_TAX_ASSET) ?? 0n;
  const liability = posted.get(ACCOUNT_CODES.DEFERRED_TAX_LIABILITY) ?? 0n;
  const dAsset = (amount > 0n ? amount : 0n) - asset;
  const dLiability = (amount < 0n ? amount : 0n) - liability;
  const lines: ProposalLine[] = [
    { code: ACCOUNT_CODES.DEFERRED_TAX_ASSET, amount: dAsset },
    { code: ACCOUNT_CODES.DEFERRED_TAX_LIABILITY, amount: dLiability },
    { code: ACCOUNT_CODES.DEFERRED_TAX, amount: -(dAsset + dLiability) },
  ];
  return lines.filter((l) => l.amount !== 0n);
}
