import type { Db } from "@/lib/db";
import type { Direction } from "@/lib/generated/prisma/enums";
import type { Classification } from "@/lib/classify/types";

/**
 * An AI suggestion of a trade receivable for money in (or a trade payable for money out) settles something — so the books must hold
 * something to settle. With nothing on the entity's PIUTANG_USAHA (or UTANG_USAHA) accounts the suggestion would leave them against
 * their nature (seen in production: every customer receipt of a client with no invoices proposed as *1130 Piutang Usaha* at 85%).
 * Such a suggestion stays a suggestion, but below the bulk accept (0.8) and the *tebakan* line (0.6), with the reason said: accepted
 * unchanged, the sanity control's "tebakan yang diterima begitu saja" raises it. Deterministic; the cached AI answer is untouched.
 */
export const UNBACKED_CONFIDENCE = 0.55;

const TRADE = { IN: "PIUTANG_USAHA", OUT: "UTANG_USAHA" } as const;

/** What the entity's books hold to settle: a debit balance on its trade receivables, a credit balance on its trade payables. */
export type TradeBacking = { receivable: boolean; payable: boolean };

export async function tradeBacking(db: Db, entityId: string): Promise<TradeBacking> {
  const rows = await db.journalLine.groupBy({
    by: ["accountId"],
    where: { entityId, account: { fsLine: { in: [TRADE.IN, TRADE.OUT] } } },
    _sum: { debit: true, credit: true },
  });
  const accounts = new Map((await db.account.findMany({ where: { id: { in: rows.map((r) => r.accountId) } }, select: { id: true, fsLine: true } })).map((a) => [a.id, a.fsLine]));
  let receivable = 0n;
  let payable = 0n;
  for (const r of rows) {
    const net = (r._sum.debit ?? 0n) - (r._sum.credit ?? 0n);
    if (accounts.get(r.accountId) === TRADE.IN) receivable += net;
    else payable -= net;
  }
  return { receivable: receivable > 0n, payable: payable > 0n };
}

/** The suggestion as Review should see it: demoted with its reason when it would settle a receivable/payable the books don't hold. */
export function demoteUnbacked(c: Classification, direction: Direction, fsLineOf: (code: string) => string | undefined, backing: TradeBacking): Classification {
  if (c.method !== "AI") return c;
  const fsLine = fsLineOf(c.accountCode);
  if (direction === "IN" && fsLine === TRADE.IN && !backing.receivable) {
    return { ...c, confidence: Math.min(c.confidence, UNBACKED_CONFIDENCE), reason: `${c.reason} · Belum ada piutang usaha tercatat untuk entitas ini: periksa apakah ini penjualan tunai.` };
  }
  if (direction === "OUT" && fsLine === TRADE.OUT && !backing.payable) {
    return { ...c, confidence: Math.min(c.confidence, UNBACKED_CONFIDENCE), reason: `${c.reason} · Belum ada utang usaha tercatat untuk entitas ini: periksa apakah ini beban atau pembelian langsung.` };
  }
  return c;
}
