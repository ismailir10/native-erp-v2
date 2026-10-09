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

/**
 * The entity's trade receivable/payable position as of any date (inclusive): one query, then each bank row asks about its own date —
 * a receivable booked after an older row can't have been what that row settled.
 */
export async function tradeBacking(db: Db, entityId: string): Promise<(asOf: Date) => TradeBacking> {
  const lines = await db.journalLine.findMany({
    where: { entityId, account: { fsLine: { in: [TRADE.IN, TRADE.OUT] } } },
    select: { date: true, debit: true, credit: true, account: { select: { fsLine: true } } },
  });
  return (asOf) => {
    let receivable = 0n;
    let payable = 0n;
    for (const l of lines) {
      if (+l.date > +asOf) continue;
      if (l.account.fsLine === TRADE.IN) receivable += l.debit - l.credit;
      else payable += l.credit - l.debit;
    }
    return { receivable: receivable > 0n, payable: payable > 0n };
  };
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
