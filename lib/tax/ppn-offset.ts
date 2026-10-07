import type { Db, Tx } from "@/lib/db";
import { LedgerError, postJournal, type PostLine } from "@/lib/ledger/post";
import { templateAccounts } from "@/lib/coa/ensure";
import { ACCOUNT_CODES } from "@/lib/coa/template";
import { formatDate, formatPeriod, periodBounds } from "@/lib/format";
import { packApplies } from "@/lib/tax/pack";
import { masaReport, PPN_OFFSET_REF } from "@/lib/tax/masa-report";

/**
 * Kompensasi PPN (accounting-rules 5j): at the end of a masa, PPN masukan is credited against keluaran, so the balance sheet shows the
 * net Utang PPN and only a lebih bayar stays on 1150. One click posts what `masaReport` computes as still to compensate: 1150's balance
 * at the masa end less the lebih bayar carried to the next masa, Dr 2130 / Cr 1150 (the other way round when compensated too much).
 * Months never compensated before are caught up in the same entry. Deterministic, so it posts directly; never automatically.
 */
export async function postPpnOffset(db: Db, input: { clientId: string; entityId: string; year: number; month: number; actorId?: string | null }) {
  const entity = await db.entity.findFirst({ where: { id: input.entityId, clientId: input.clientId } });
  if (!entity) throw new LedgerError("Entitas tidak ditemukan.");
  if (!packApplies(entity)) throw new LedgerError("Kompensasi PPN hanya untuk badan usaha (PT/CV) dengan pembukuan Rupiah.");
  const report = (await masaReport(db, input))!;
  const ppn = report.rows.find((r) => r.key === "PPN")!.ppn!;
  const label = formatPeriod(input.year, input.month);
  if (ppn.offsetLater) throw new LedgerError(`Kompensasi PPN sudah dijurnal per ${formatDate(ppn.offsetLater)}. Catat perubahan di masa itu atau sesudahnya.`);
  if (ppn.offset === 0n) throw new LedgerError(`Tidak ada PPN masukan yang perlu dikompensasikan masa ${label}.`);
  const { end } = periodBounds(input.year, input.month);
  const seen = await balances(db, input.clientId, input.entityId, end);

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ppn-offset:${input.entityId}`}, 0))::text`;
    const now = await balances(tx, input.clientId, input.entityId, end);
    const later = await tx.journalEntry.findFirst({ where: { entityId: input.entityId, sourceRef: { startsWith: PPN_OFFSET_REF }, date: { gt: end } }, select: { id: true } });
    if (now !== seen || later) throw new LedgerError("PPN berubah sementara itu. Muat ulang halaman lalu coba lagi.");
    const ids = await templateAccounts(tx, input.clientId, [ACCOUNT_CODES.PPN_KELUARAN, ACCOUNT_CODES.PPN_MASUKAN]);
    const amount = ppn.offset > 0n ? ppn.offset : -ppn.offset;
    const [dr, cr] = ppn.offset > 0n ? [ACCOUNT_CODES.PPN_KELUARAN, ACCOUNT_CODES.PPN_MASUKAN] : [ACCOUNT_CODES.PPN_MASUKAN, ACCOUNT_CODES.PPN_KELUARAN];
    const lines: PostLine[] = [{ accountId: ids.get(dr)!, debit: amount }, { accountId: ids.get(cr)!, credit: amount }];
    return postJournal(tx, {
      entityId: input.entityId,
      date: end,
      kind: "ADJUSTMENT",
      memo: ppn.offset > 0n ? `Kompensasi PPN masukan ke PPN keluaran masa ${label}` : `Koreksi kompensasi PPN masa ${label}`,
      sourceRef: `${PPN_OFFSET_REF}${input.year}-${String(input.month).padStart(2, "0")}`,
      lines,
      actorId: input.actorId,
    });
  });
}

/** 2130 and 1150 through the masa end, as one comparable string: a change between reading and posting means stale numbers. */
async function balances(db: Db | Tx, clientId: string, entityId: string, end: Date): Promise<string> {
  const accounts = await db.account.findMany({ where: { clientId, code: { in: [ACCOUNT_CODES.PPN_KELUARAN, ACCOUNT_CODES.PPN_MASUKAN] } }, select: { id: true, code: true } });
  const sums = await db.journalLine.groupBy({ by: ["accountId"], where: { entityId, accountId: { in: accounts.map((a) => a.id) }, date: { lte: end } }, _sum: { debit: true, credit: true } });
  return accounts
    .map((a) => {
      const s = sums.find((x) => x.accountId === a.id);
      return `${a.code}:${(s?._sum.debit ?? 0n) - (s?._sum.credit ?? 0n)}`;
    })
    .sort()
    .join("|");
}
