import type { Db } from "@/lib/db";
import type { Account } from "@/lib/generated/prisma/client";
import { FS_LINES, type FsLine } from "@/lib/coa/template";
import { dateOnly } from "@/lib/format";

/**
 * All reports derive from JournalLine at read time (GL = single source of truth).
 * Sign convention inside this module: `net` = debit − credit.
 */
export type Scope = { clientId: string; entityIds: string[] };

export async function sumByAccount(db: Db, scope: Scope, range: { from?: Date; to: Date }, byEntity = false) {
  const rows = await db.journalLine.groupBy({
    by: byEntity ? ["accountId", "entityId"] : ["accountId"],
    where: { entityId: { in: scope.entityIds }, date: { gte: range.from, lte: range.to } },
    _sum: { debit: true, credit: true },
  });
  return rows.map((r) => ({
    accountId: r.accountId,
    entityId: (r as { entityId?: string }).entityId ?? null,
    debit: r._sum.debit ?? 0n,
    credit: r._sum.credit ?? 0n,
  }));
}

const isPL = (a: Account) => a.type === "PENDAPATAN" || a.type === "BEBAN";

export type TbRow = { account: Account; debit: bigint; credit: bigint; net: bigint };

/**
 * Trial balance as of `asOf`: balance-sheet accounts cumulative, P&L accounts from 1 Jan of
 * asOf's year. Prior-year P&L is folded into retained earnings (3200) so the TB always balances.
 */
export async function trialBalance(db: Db, scope: Scope, asOf: Date): Promise<TbRow[]> {
  const accounts = await db.account.findMany({ where: { clientId: scope.clientId }, orderBy: { code: "asc" } });
  const yearStart = dateOnly(asOf.getUTCFullYear(), 1, 1);
  const [all, ytd] = await Promise.all([sumByAccount(db, scope, { to: asOf }), sumByAccount(db, scope, { from: yearStart, to: asOf })]);
  const allMap = new Map(all.map((r) => [r.accountId, r]));
  const ytdMap = new Map(ytd.map((r) => [r.accountId, r]));

  let priorPl = 0n;
  const rows: TbRow[] = [];
  for (const a of accounts) {
    const src = isPL(a) ? ytdMap.get(a.id) : allMap.get(a.id);
    if (isPL(a)) {
      const allNet = (allMap.get(a.id)?.debit ?? 0n) - (allMap.get(a.id)?.credit ?? 0n);
      const ytdNet = (src?.debit ?? 0n) - (src?.credit ?? 0n);
      priorPl += allNet - ytdNet;
    }
    const net = (src?.debit ?? 0n) - (src?.credit ?? 0n);
    rows.push({ account: a, net, debit: net > 0n ? net : 0n, credit: net < 0n ? -net : 0n });
  }
  if (priorPl !== 0n) {
    const re = rows.find((r) => r.account.isRetained);
    if (re) {
      re.net += priorPl;
      re.debit = re.net > 0n ? re.net : 0n;
      re.credit = re.net < 0n ? -re.net : 0n;
    }
  }
  return rows;
}

export type FsItem = { fsLine: FsLine | "LABA_BERJALAN" | "UTANG_ANTAR_ENTITAS"; label: string; amount: bigint; accounts: { code: string; name: string; amount: bigint }[] };
export type IncomeStatement = {
  revenue: FsItem[];
  cogs: FsItem[];
  opex: FsItem[];
  other: FsItem[];
  tax: FsItem[];
  totals: { revenue: bigint; grossProfit: bigint; operatingProfit: bigint; profitBeforeTax: bigint; netProfit: bigint };
};

function group(rows: { account: Account; amount: bigint }[], lines: FsLine[]): FsItem[] {
  return lines
    .map((fs) => {
      const accs = rows.filter((r) => r.account.fsLine === fs && r.amount !== 0n);
      return {
        fsLine: fs,
        label: FS_LINES[fs].label,
        amount: accs.reduce((s, r) => s + r.amount, 0n),
        accounts: accs.map((r) => ({ code: r.account.code, name: r.account.name, amount: r.amount })),
      };
    })
    .filter((i) => i.accounts.length > 0);
}

const sum = (items: FsItem[]) => items.reduce((s, i) => s + i.amount, 0n);

/** Laba Rugi for [from, to]. Income positive, expenses positive; net = income − expenses. */
export async function incomeStatement(db: Db, scope: Scope, from: Date, to: Date): Promise<IncomeStatement> {
  const accounts = await db.account.findMany({ where: { clientId: scope.clientId, type: { in: ["PENDAPATAN", "BEBAN"] } } });
  const sums = new Map((await sumByAccount(db, scope, { from, to })).map((r) => [r.accountId, r]));
  const rows = accounts.map((a) => {
    const s = sums.get(a.id);
    const net = (s?.debit ?? 0n) - (s?.credit ?? 0n);
    return { account: a, amount: a.type === "PENDAPATAN" ? -net : net };
  });
  const revenue = group(rows, ["PENDAPATAN_USAHA"]);
  const cogs = group(rows, ["HPP"]);
  const opex = group(rows, ["BEBAN_PENJUALAN", "BEBAN_UMUM_ADM"]);
  const otherIncome = group(rows, ["PENDAPATAN_LAIN"]);
  const otherExpense = group(rows, ["BEBAN_LAIN"]).map((i) => ({ ...i, amount: -i.amount, accounts: i.accounts.map((a) => ({ ...a, amount: -a.amount })) }));
  const tax = group(rows, ["BEBAN_PAJAK"]);
  const tRevenue = sum(revenue);
  const gross = tRevenue - sum(cogs);
  const operating = gross - sum(opex);
  const pbt = operating + sum(otherIncome) + sum(otherExpense);
  return {
    revenue,
    cogs,
    opex,
    other: [...otherIncome, ...otherExpense],
    tax,
    totals: { revenue: tRevenue, grossProfit: gross, operatingProfit: operating, profitBeforeTax: pbt, netProfit: pbt - sum(tax) },
  };
}

export type BalanceSheet = {
  currentAssets: FsItem[];
  nonCurrentAssets: FsItem[];
  liabilities: FsItem[];
  equity: FsItem[];
  totals: { assets: bigint; liabilities: bigint; equity: bigint; difference: bigint };
};

/** Neraca as of `asOf`. Current-year profit shown as its own equity line so A = L + E. */
export async function balanceSheet(db: Db, scope: Scope, asOf: Date): Promise<BalanceSheet> {
  const tb = await trialBalance(db, scope, asOf);
  const bs = tb.filter((r) => !isPL(r.account));
  const assetRows = bs.filter((r) => r.account.type === "ASET").map((r) => ({ account: r.account, amount: r.net }));
  // Intercompany with a credit balance is presented as a liability ("utang antar entitas").
  const icCredit = assetRows.filter((r) => r.account.isIntercompany && r.amount < 0n);
  const assets = assetRows.filter((r) => !icCredit.includes(r));
  const liabRows = bs.filter((r) => r.account.type === "LIABILITAS").map((r) => ({ account: r.account, amount: -r.net }));
  const eqRows = bs.filter((r) => r.account.type === "EKUITAS").map((r) => ({ account: r.account, amount: -r.net }));

  const currentAssets = group(assets, ["KAS_SETARA_KAS", "PIUTANG_USAHA", "PIUTANG_LAIN", "PERSEDIAAN", "PAJAK_DIBAYAR_DIMUKA", "BIAYA_DIBAYAR_DIMUKA", "SUSPENSE"]);
  const nonCurrentAssets = group(assets, ["ASET_TETAP", "AKUM_PENYUSUTAN"]);
  const liabilities = group(liabRows, ["UTANG_USAHA", "UTANG_PAJAK", "UTANG_LAIN", "UTANG_BANK"]);
  if (icCredit.length) {
    const amount = icCredit.reduce((s, r) => s - r.amount, 0n);
    liabilities.push({ fsLine: "UTANG_ANTAR_ENTITAS", label: "Utang antar entitas", amount, accounts: icCredit.map((r) => ({ code: r.account.code, name: r.account.name, amount: -r.amount })) });
  }
  const equity = group(eqRows, ["MODAL", "SALDO_LABA", "PRIVE", "SELISIH_PENJABARAN"]);
  const ytdProfit = tb.filter((r) => isPL(r.account)).reduce((s, r) => s - r.net, 0n);
  equity.push({ fsLine: "LABA_BERJALAN", label: "Laba (rugi) tahun berjalan", amount: ytdProfit, accounts: [] });

  const tA = sum(currentAssets) + sum(nonCurrentAssets);
  const tL = sum(liabilities);
  const tE = sum(equity);
  return { currentAssets, nonCurrentAssets, liabilities, equity, totals: { assets: tA, liabilities: tL, equity: tE, difference: tA - tL - tE } };
}

/**
 * Kertas kerja gabungan: TB per entity side by side + intercompany elimination.
 * Intercompany (1190) is split into receivable (+) and payable (−) rows; the matched amount
 * min(Σpiutang, Σutang) is eliminated from both. Whatever remains is the unexplained residual.
 */
export type WorksheetRow = { key: string; code: string; name: string; values: bigint[]; elimination: bigint; combined: bigint };

export async function combinedWorksheet(db: Db, clientId: string, asOf: Date) {
  // Companies first, individuals (owners) last — how accountants read a group.
  const entities = (await db.entity.findMany({ where: { clientId }, orderBy: { name: "asc" } })).sort(
    (a, b) => Number(a.kind === "PERORANGAN") - Number(b.kind === "PERORANGAN"),
  );
  const perEntity = await Promise.all(entities.map((e) => trialBalance(db, { clientId, entityIds: [e.id] }, asOf)));
  const accounts = perEntity[0]?.map((r) => r.account) ?? [];
  const rows: WorksheetRow[] = [];
  let residual = 0n;
  let matched = 0n;
  accounts.forEach((account, i) => {
    const values = perEntity.map((tb) => tb[i].net);
    if (values.every((v) => v === 0n)) return;
    if (!account.isIntercompany) {
      rows.push({ key: account.code, code: account.code, name: account.name, values, elimination: 0n, combined: values.reduce((s, v) => s + v, 0n) });
      return;
    }
    const recv = values.map((v) => (v > 0n ? v : 0n));
    const pay = values.map((v) => (v < 0n ? v : 0n));
    const P = recv.reduce((s, v) => s + v, 0n);
    const N = -pay.reduce((s, v) => s + v, 0n);
    const m = P < N ? P : N;
    matched += m;
    residual += P - N;
    rows.push({ key: `${account.code}-P`, code: account.code, name: "Piutang antar entitas", values: recv, elimination: -m, combined: P - m });
    rows.push({ key: `${account.code}-U`, code: account.code, name: "Utang antar entitas", values: pay, elimination: m, combined: -(N - m) });
  });
  return { entities, rows, matched, residual };
}

export type MonthPoint = { year: number; month: number; cash: bigint; revenue: bigint; expense: bigint };

/** Month-end cash + monthly revenue/expense for charts (last `months` months up to asOf). */
export async function monthlySeries(db: Db, scope: Scope, asOf: Date, months = 6): Promise<MonthPoint[]> {
  const accounts = await db.account.findMany({ where: { clientId: scope.clientId } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const lines = await db.journalLine.findMany({
    where: { entityId: { in: scope.entityIds }, date: { lte: asOf } },
    select: { accountId: true, date: true, debit: true, credit: true },
  });
  const points: MonthPoint[] = [];
  for (let k = months - 1; k >= 0; k--) {
    const d = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - k, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const end = new Date(Date.UTC(y, m, 0));
    let cash = 0n, revenue = 0n, expense = 0n;
    for (const l of lines) {
      const a = byId.get(l.accountId)!;
      const net = l.debit - l.credit;
      if (a.isBank && l.date <= end) cash += net;
      if (l.date.getUTCFullYear() === y && l.date.getUTCMonth() + 1 === m) {
        if (a.type === "PENDAPATAN") revenue -= net;
        if (a.type === "BEBAN") expense += net;
      }
    }
    points.push({ year: y, month: m, cash, revenue, expense });
  }
  return points;
}
