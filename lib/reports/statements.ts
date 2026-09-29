import type { Db } from "@/lib/db";
import type { Account } from "@/lib/generated/prisma/client";
import { ACCOUNT_CODES, FS_LINES, type FsLine } from "@/lib/coa/template";
import { dateOnly } from "@/lib/format";
import { isMixed, scopeEntities } from "@/lib/reports/fx";
import { balanceSheet, incomeStatement, sumByAccount, type Scope } from "@/lib/reports/ledger";

/**
 * The statements beyond Laba Rugi and Neraca (accounting-rules 12): other comprehensive income, changes in equity and the indirect cash
 * flow, all from the GL movements of the period, so opening + movements = closing by construction and each is checked against the Neraca.
 * Single-currency scopes only (a mixed scope's translation isn't split into movements).
 */

export class MixedScopeError extends Error {
  constructor() {
    super("Laporan ini hanya untuk cakupan satu mata uang. Pilih satu entitas atau entitas dengan mata uang yang sama.");
  }
}

const C = ACCOUNT_CODES;
const OCI_LINES: FsLine[] = ["PKL_IMBALAN_KERJA", "SELISIH_PENJABARAN"];

type Movement = { account: Account; debit: bigint; credit: bigint; net: bigint };

async function movements(db: Db, scope: Scope, from: Date | undefined, to: Date): Promise<Movement[]> {
  const accounts = await db.account.findMany({ where: { clientId: scope.clientId }, orderBy: { code: "asc" } });
  const byId = new Map((await sumByAccount(db, scope, { from, to })).map((r) => [r.accountId, r]));
  return accounts.map((a) => {
    const r = byId.get(a.id);
    const debit = r?.debit ?? 0n;
    const credit = r?.credit ?? 0n;
    return { account: a, debit, credit, net: debit - credit };
  });
}

async function single(db: Db, scope: Scope) {
  if (isMixed(await scopeEntities(db, scope.entityIds))) throw new MixedScopeError();
}

export type OciItem = { fsLine: FsLine; label: string; amount: bigint; accounts: { code: string; name: string; amount: bigint }[] };

/** Other comprehensive income of [from, to]: the credit movement of the PKL equity lines. */
export async function otherComprehensiveIncome(db: Db, scope: Scope, from: Date, to: Date): Promise<{ items: OciItem[]; total: bigint }> {
  const rows = (await movements(db, scope, from, to)).filter((m) => OCI_LINES.includes(m.account.fsLine as FsLine) && m.net !== 0n);
  const items = OCI_LINES.map((fs) => {
    const accs = rows.filter((r) => r.account.fsLine === fs);
    return { fsLine: fs, label: FS_LINES[fs].label, amount: accs.reduce((t, r) => t - r.net, 0n), accounts: accs.map((r) => ({ code: r.account.code, name: r.account.name, amount: -r.net })) };
  }).filter((i) => i.accounts.length);
  return { items, total: items.reduce((t, i) => t + i.amount, 0n) };
}

// ─── Laporan Perubahan Ekuitas ────────────────────────────────────────────────

export const EQUITY_ROWS = ["opening", "profit", "oci", "capital", "prive", "retained", "closing"] as const;
export type EquityRow = (typeof EQUITY_ROWS)[number];
export const EQUITY_ROW_LABEL: Record<EquityRow, string> = {
  opening: "Saldo awal",
  profit: "Laba (rugi) tahun berjalan",
  oci: "Penghasilan komprehensif lain",
  capital: "Setoran (penarikan) modal",
  prive: "Prive",
  retained: "Dividen dan koreksi saldo laba",
  closing: "Saldo akhir",
};
const EQUITY_LINES: FsLine[] = ["MODAL", "SALDO_LABA", "PRIVE", "SELISIH_PENJABARAN", "PKL_IMBALAN_KERJA"];
/** The row a year's movement of an equity line goes to (profit itself comes from the income statement). */
const ROW_OF: Record<string, EquityRow> = { MODAL: "capital", SALDO_LABA: "retained", PRIVE: "prive", SELISIH_PENJABARAN: "oci", PKL_IMBALAN_KERJA: "oci" };

export type EquityChanges = {
  from: Date;
  to: Date;
  columns: { fsLine: FsLine; label: string }[];
  /** values[row][column], credit positive; the last column of each row is not included — `totals[row]` is the row total. */
  values: Record<EquityRow, bigint[]>;
  totals: Record<EquityRow, bigint>;
  /** Neraca equity at `to` (should equal totals.closing). */
  balanceSheetEquity: bigint;
};

/** Changes in equity from 1 January of `to`'s year to `to`. Prior-year profit sits in Saldo laba at the opening. */
export async function equityChanges(db: Db, scope: Scope, to: Date): Promise<EquityChanges> {
  await single(db, scope);
  const from = dateOnly(to.getUTCFullYear(), 1, 1);
  const before = dateOnly(to.getUTCFullYear() - 1, 12, 31);
  const [opening, moved, is, bs] = await Promise.all([movements(db, scope, undefined, before), movements(db, scope, from, to), incomeStatement(db, scope, from, to), balanceSheet(db, scope, to)]);
  const zero = () => EQUITY_LINES.map(() => 0n);
  const values = Object.fromEntries(EQUITY_ROWS.map((r) => [r, zero()])) as Record<EquityRow, bigint[]>;
  const col = (a: Account) => EQUITY_LINES.indexOf(a.fsLine as FsLine);
  for (const m of opening) {
    // Every P&L account up to last year is last year's (and earlier) profit, folded into Saldo laba.
    if (m.account.type === "PENDAPATAN" || m.account.type === "BEBAN") values.opening[1] -= m.net;
    else if (m.account.type === "EKUITAS" && col(m.account) >= 0) values.opening[col(m.account)] -= m.net;
  }
  for (const m of moved) {
    if (m.account.type !== "EKUITAS" || col(m.account) < 0 || m.net === 0n) continue;
    values[ROW_OF[m.account.fsLine]][col(m.account)] -= m.net;
  }
  values.profit[1] = is.totals.netProfit;
  values.closing = EQUITY_LINES.map((_, i) => EQUITY_ROWS.slice(0, -1).reduce((t, r) => t + values[r][i], 0n));
  const used = EQUITY_LINES.map((fs, i) => ({ fs, i })).filter(({ fs, i }) => fs === "MODAL" || fs === "SALDO_LABA" || EQUITY_ROWS.some((r) => values[r][i] !== 0n));
  const pick = (xs: bigint[]) => used.map(({ i }) => xs[i]);
  const picked = Object.fromEntries(EQUITY_ROWS.map((r) => [r, pick(values[r])])) as Record<EquityRow, bigint[]>;
  const totals = Object.fromEntries(EQUITY_ROWS.map((r) => [r, picked[r].reduce((t, v) => t + v, 0n)])) as Record<EquityRow, bigint>;
  return { from, to, columns: used.map(({ fs }) => ({ fsLine: fs, label: FS_LINES[fs].label })), values: picked, totals, balanceSheetEquity: bs.totals.equity };
}

// ─── Laporan Arus Kas (tidak langsung) ────────────────────────────────────────

export type CashSection = "OPERATING" | "INVESTING" | "FINANCING";
export type CashItem = { key: string; label: string; amount: bigint; codes: string[] };
export type CashFlow = {
  from: Date;
  to: Date;
  netProfit: bigint;
  operating: CashItem[];
  investing: CashItem[];
  financing: CashItem[];
  totals: Record<CashSection, bigint>;
  net: bigint;
  openingCash: bigint;
  closingCash: bigint;
};

const LEASE_CODES = new Set<string>([C.ROU_ASSET, C.LEASE_CURRENT, C.LEASE_NON_CURRENT]);
const DEFERRED_TAX_CODES = new Set<string>([C.DEFERRED_TAX_ASSET, C.DEFERRED_TAX_LIABILITY]);

/** Where a balance-sheet account's movement goes in the cash flow, and under which line; null for cash itself. */
export function cashLine(a: Pick<Account, "code" | "fsLine" | "isIntercompany">): { section: CashSection; key: string; label: string } | null {
  if (a.fsLine === "KAS_SETARA_KAS") return null;
  if (a.isIntercompany) return { section: "FINANCING", key: "INTERCOMPANY", label: "Pinjaman antar entitas" };
  if (LEASE_CODES.has(a.code)) return { section: "FINANCING", key: "LEASES", label: "Pembayaran liabilitas sewa" };
  if (a.code === C.ROU_ACCUMULATED) return { section: "OPERATING", key: "AKUM_PENYUSUTAN", label: "Penyusutan dan amortisasi" };
  if (a.code === C.BENEFIT_LIABILITY) return { section: "OPERATING", key: "BENEFITS", label: "Liabilitas imbalan kerja" };
  if (DEFERRED_TAX_CODES.has(a.code)) return { section: "OPERATING", key: "DEFERRED_TAX", label: "Pajak tangguhan" };
  const fs = a.fsLine as FsLine;
  const label = FS_LINES[fs]?.label ?? fs;
  switch (fs) {
    case "AKUM_PENYUSUTAN":
      return { section: "OPERATING", key: fs, label: "Penyusutan dan amortisasi" };
    case "ASET_TETAP":
      return { section: "INVESTING", key: fs, label: "Aset tetap" };
    case "ASET_TIDAK_LANCAR_LAIN":
      return { section: "INVESTING", key: fs, label };
    case "UTANG_BANK":
    case "UTANG_JANGKA_PANJANG":
      return { section: "FINANCING", key: fs, label };
    case "MODAL":
      return { section: "FINANCING", key: fs, label: "Setoran (penarikan) modal" };
    case "PRIVE":
      return { section: "FINANCING", key: fs, label: "Prive" };
    case "SALDO_LABA":
      return { section: "FINANCING", key: fs, label: "Dividen dan koreksi saldo laba" };
    case "PKL_IMBALAN_KERJA":
    case "SELISIH_PENJABARAN":
      return { section: "OPERATING", key: "OCI", label: "Penghasilan komprehensif lain (non-kas)" };
    default:
      return { section: "OPERATING", key: fs, label };
  }
}

/** Indirect cash flow from 1 January of `to`'s year to `to`: net profit and the movement of every other balance-sheet account. */
export async function cashFlow(db: Db, scope: Scope, to: Date): Promise<CashFlow> {
  await single(db, scope);
  const from = dateOnly(to.getUTCFullYear(), 1, 1);
  const before = dateOnly(to.getUTCFullYear() - 1, 12, 31);
  const [moved, opening] = await Promise.all([movements(db, scope, from, to), movements(db, scope, undefined, before)]);
  const isPl = (a: Account) => a.type === "PENDAPATAN" || a.type === "BEBAN";
  const netProfit = moved.filter((m) => isPl(m.account)).reduce((t, m) => t - m.net, 0n);
  const groups = new Map<string, CashItem & { section: CashSection }>();
  for (const m of moved) {
    if (isPl(m.account) || m.net === 0n) continue;
    const line = cashLine(m.account);
    if (!line) continue;
    const g = groups.get(line.key) ?? { key: line.key, label: line.label, amount: 0n, codes: [], section: line.section };
    g.amount -= m.net; // an asset that grew used cash; a liability or equity that grew brought it
    g.codes.push(m.account.code);
    groups.set(line.key, g);
  }
  const of = (s: CashSection) => [...groups.values()].filter((g) => g.section === s && g.amount !== 0n).map(({ key, label, amount, codes }) => ({ key, label, amount, codes }));
  const operating = of("OPERATING");
  const investing = of("INVESTING");
  const financing = of("FINANCING");
  const totals = { OPERATING: netProfit + operating.reduce((t, i) => t + i.amount, 0n), INVESTING: investing.reduce((t, i) => t + i.amount, 0n), FINANCING: financing.reduce((t, i) => t + i.amount, 0n) };
  const cash = (xs: Movement[]) => xs.filter((m) => m.account.fsLine === "KAS_SETARA_KAS").reduce((t, m) => t + m.net, 0n);
  const openingCash = cash(opening);
  return { from, to, netProfit, operating, investing, financing, totals, net: totals.OPERATING + totals.INVESTING + totals.FINANCING, openingCash, closingCash: openingCash + cash(moved) };
}
