import type { Db } from "@/lib/db";
import type { AccountType } from "@/lib/generated/prisma/enums";
import { dateOnly } from "@/lib/format";
import { postedBasis } from "@/lib/reports/account-ledger";

/**
 * Neraca Saldo in the entity's own accounts (rule 9a): lines grouped by source account, in the entity's functional currency.
 * Lines without a source account (bank lines, adjustments, 7190, 1999) are grouped by client account. Same convention as
 * the client TB: balance-sheet accounts cumulative, income & expense from 1 Jan; earlier years' result is one row.
 * `net` is the closing balance; the month's movement gives opening + debit − credit = net.
 */
export type SourceTbRow = {
  key: string;
  code: string;
  name: string;
  previousNames: string[];
  /** The Buku account this row is presented under (mapped account, or the line's own account). */
  clientAccount: { code: string; name: string } | null;
  sourceAccountId: string | null;
  accountCode: string;
  type: AccountType | null;
  isSource: boolean;
  opening: bigint;
  periodDebit: bigint;
  periodCredit: bigint;
  periodLines: number;
  net: bigint;
};

export async function sourceTrialBalance(db: Db, entityId: string, asOf: Date, start = dateOnly(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 1)): Promise<SourceTbRow[]> {
  const yearStart = dateOnly(asOf.getUTCFullYear(), 1, 1);
  const by = ["accountId", "sourceAccountId"] as const;
  const [lines, ytd, month] = await Promise.all([
    db.journalLine.groupBy({ by: [...by], where: { entityId, date: { lte: asOf } }, _sum: { debit: true, credit: true } }),
    db.journalLine.groupBy({ by: [...by], where: { entityId, date: { gte: yearStart, lte: asOf } }, _sum: { debit: true, credit: true } }),
    db.journalLine.groupBy({ by: [...by], where: { entityId, date: { gte: start, lte: asOf } }, _sum: { debit: true, credit: true }, _count: true }),
  ]);
  const k = (r: { accountId: string; sourceAccountId: string | null }) => `${r.accountId}|${r.sourceAccountId ?? ""}`;
  const ytdKey = new Map(ytd.map((r) => [k(r), (r._sum.debit ?? 0n) - (r._sum.credit ?? 0n)]));
  const monthKey = new Map(month.map((r) => [k(r), r]));
  const accounts = new Map((await db.account.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.accountId))] } } })).map((a) => [a.id, a]));
  const sources = new Map(
    (await db.sourceAccount.findMany({ where: { id: { in: lines.map((l) => l.sourceAccountId).filter((x): x is string => !!x) } } })).map((s) => [s.id, s]),
  );
  const rows = new Map<string, SourceTbRow>();
  let priorResult = 0n;
  for (const l of lines) {
    const a = accounts.get(l.accountId)!;
    const s = l.sourceAccountId ? sources.get(l.sourceAccountId) : null;
    const all = (l._sum.debit ?? 0n) - (l._sum.credit ?? 0n);
    const isPL = a.type === "PENDAPATAN" || a.type === "BEBAN";
    const current = isPL ? (ytdKey.get(k(l)) ?? 0n) : all;
    if (isPL) priorResult += all - current;
    const m = monthKey.get(k(l));
    const key = s ? `s:${s.id}` : `a:${a.id}`;
    const row = rows.get(key) ?? {
      key,
      code: s?.code ?? a.code,
      name: s?.name ?? a.name,
      previousNames: s?.previousNames ?? [],
      clientAccount: s ? { code: a.code, name: a.name } : null,
      sourceAccountId: s?.id ?? null,
      accountCode: a.code,
      type: a.type,
      isSource: Boolean(s),
      opening: 0n,
      periodDebit: 0n,
      periodCredit: 0n,
      periodLines: 0,
      net: 0n,
    };
    row.net += current;
    row.periodDebit += m?._sum.debit ?? 0n;
    row.periodCredit += m?._sum.credit ?? 0n;
    row.periodLines += m?._count ?? 0;
    rows.set(key, row);
  }
  // A client account posted to several Buku accounts is presented under the same one its ledger reads by (never whichever group
  // came first): the earliest posted account of the file's type, else the earliest posted.
  const mixed = [...rows.values()].filter((r) => r.sourceAccountId && lines.filter((l) => l.sourceAccountId === r.sourceAccountId).length > 1);
  if (mixed.length) {
    const posted = await db.journalLine.findMany({
      where: { entityId, sourceAccountId: { in: mixed.map((r) => r.sourceAccountId!) }, date: { lte: asOf } }, // the same horizon as the rows
      distinct: ["sourceAccountId", "accountId"],
      orderBy: [{ date: "asc" }, { id: "asc" }],
      select: { sourceAccountId: true, accountId: true, date: true, id: true },
    });
    posted.sort((x, y) => +x.date - +y.date || x.id.localeCompare(y.id));
    for (const r of mixed) {
      const mine = posted.filter((p) => p.sourceAccountId === r.sourceAccountId).flatMap((p) => accounts.get(p.accountId) ?? []);
      const a = postedBasis(mine, sources.get(r.sourceAccountId!)?.typeHint ?? null);
      if (a) Object.assign(r, { type: a.type, accountCode: a.code, clientAccount: { code: a.code, name: a.name } });
    }
  }
  for (const r of rows.values()) r.opening = r.net - (r.periodDebit - r.periodCredit);
  const out = [...rows.values()]
    .filter((r) => r.net !== 0n || r.periodLines > 0)
    .sort((x, y) => Number(y.isSource) - Number(x.isSource) || x.code.localeCompare(y.code, "id", { numeric: true }));
  if (priorResult !== 0n) {
    out.push({ key: "prior", code: "", name: "Laba (rugi) tahun-tahun sebelumnya", previousNames: [], clientAccount: null, sourceAccountId: null, accountCode: "3200", type: "EKUITAS", isSource: false, opening: priorResult, periodDebit: 0n, periodCredit: 0n, periodLines: 0, net: priorResult });
  }
  return out;
}

/**
 * The client accounts behind each Buku account of one entity (report drill). `net` = debit − credit over the range
 * (balance-sheet: everything up to `to`; pass `from` for income & expense). Lines without a client account are one row
 * with `sourceAccountId: null`. The caller shows any remainder against the report amount (e.g. prior-year result in 3200).
 */
export type ClientAccountPart = { sourceAccountId: string | null; code: string; name: string; net: bigint };

export async function clientAccountsByAccount(db: Db, entityId: string, range: { from?: Date; to: Date }): Promise<Map<string, ClientAccountPart[]>> {
  const groups = await db.journalLine.groupBy({
    by: ["accountId", "sourceAccountId"],
    where: { entityId, date: { gte: range.from, lte: range.to } },
    _sum: { debit: true, credit: true },
  });
  const accounts = new Map((await db.account.findMany({ where: { id: { in: [...new Set(groups.map((g) => g.accountId))] } } })).map((a) => [a.id, a]));
  const sources = new Map((await db.sourceAccount.findMany({ where: { id: { in: groups.map((g) => g.sourceAccountId).filter((x): x is string => !!x) } } })).map((s) => [s.id, s]));
  const out = new Map<string, ClientAccountPart[]>();
  for (const g of groups) {
    const net = (g._sum.debit ?? 0n) - (g._sum.credit ?? 0n);
    if (net === 0n) continue;
    const a = accounts.get(g.accountId)!;
    const s = g.sourceAccountId ? sources.get(g.sourceAccountId) : null;
    const list = out.get(a.code) ?? [];
    list.push(s ? { sourceAccountId: s.id, code: s.code, name: s.name, net } : { sourceAccountId: null, code: a.code, name: "Tanpa akun klien (mutasi bank, penyesuaian)", net });
    out.set(a.code, list);
  }
  for (const list of out.values()) list.sort((x, y) => Number(x.sourceAccountId === null) - Number(y.sourceAccountId === null) || x.code.localeCompare(y.code, "id", { numeric: true }));
  return out;
}
