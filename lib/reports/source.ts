import type { Db } from "@/lib/db";
import { dateOnly } from "@/lib/format";

/**
 * Neraca Saldo in the entity's own accounts (rule 9a): lines grouped by source account, in the entity's functional currency.
 * Lines without a source account (bank lines, adjustments, 7190, 1999) are grouped by client account. Same convention as
 * the client TB: balance-sheet accounts cumulative, income & expense from 1 Jan; earlier years' result is one row.
 */
export type SourceTbRow = {
  key: string;
  code: string;
  name: string;
  previousNames: string[];
  clientAccount: { code: string; name: string } | null;
  isSource: boolean;
  net: bigint;
};

export async function sourceTrialBalance(db: Db, entityId: string, asOf: Date): Promise<SourceTbRow[]> {
  const yearStart = dateOnly(asOf.getUTCFullYear(), 1, 1);
  const lines = await db.journalLine.groupBy({
    by: ["accountId", "sourceAccountId"],
    where: { entityId, date: { lte: asOf } },
    _sum: { debit: true, credit: true },
  });
  const ytd = await db.journalLine.groupBy({
    by: ["accountId", "sourceAccountId"],
    where: { entityId, date: { gte: yearStart, lte: asOf } },
    _sum: { debit: true, credit: true },
  });
  const ytdKey = new Map(ytd.map((r) => [`${r.accountId}|${r.sourceAccountId ?? ""}`, (r._sum.debit ?? 0n) - (r._sum.credit ?? 0n)]));
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
    const current = isPL ? (ytdKey.get(`${l.accountId}|${l.sourceAccountId ?? ""}`) ?? 0n) : all;
    if (isPL) priorResult += all - current;
    const key = s ? `s:${s.id}` : `a:${a.id}`;
    const row = rows.get(key) ?? {
      key,
      code: s?.code ?? a.code,
      name: s?.name ?? a.name,
      previousNames: s?.previousNames ?? [],
      clientAccount: s ? { code: a.code, name: a.name } : null,
      isSource: Boolean(s),
      net: 0n,
    };
    row.net += current;
    rows.set(key, row);
  }
  const out = [...rows.values()].filter((r) => r.net !== 0n).sort((x, y) => Number(y.isSource) - Number(x.isSource) || x.code.localeCompare(y.code, "id", { numeric: true }));
  if (priorResult !== 0n) out.push({ key: "prior", code: "", name: "Laba (rugi) tahun-tahun sebelumnya", previousNames: [], clientAccount: null, isSource: false, net: priorResult });
  return out;
}
