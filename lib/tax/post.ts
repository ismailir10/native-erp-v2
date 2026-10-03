import type { Db } from "@/lib/db";
import type { TaxPostingKind } from "@/lib/generated/prisma/enums";
import { LedgerError, postJournal, type PostLine } from "@/lib/ledger/post";
import { fiscalEndMonth } from "@/lib/fiscal";
import { templateAccounts } from "@/lib/coa/ensure";
import { ACCOUNT_CODES } from "@/lib/coa/template";
import { formatDate, formatPeriod } from "@/lib/format";
import { postedLines, postingAfter, taxPack } from "@/lib/tax/pack";

/**
 * Tax journals from the pack (accounting-rules 5d), by the accountant's click: one ADJUSTMENT entry dated the period end that books only
 * the difference between the computed position and what earlier postings of that kind already booked, so posting again after a change
 * adjusts instead of doubling. Serialised per entity-year; a posting that sees other postings appear meanwhile refuses.
 */
export async function postTax(db: Db, input: { clientId: string; entityId: string; year: number; month: number; kind: TaxPostingKind; actorId?: string | null }) {
  if (input.kind !== "CURRENT" && input.kind !== "DEFERRED") throw new LedgerError("Pilih jurnal pajak.");
  const pack = await taxPack(db, input.clientId, input.entityId, input.year, input.month);
  if (!pack) throw new LedgerError("Entitas tidak ditemukan.");
  if (!pack.applicable) throw new LedgerError("Paket PPh badan hanya untuk badan usaha dengan pembukuan Rupiah.");
  if ((await fiscalEndMonth(db, input.clientId)) !== 12) throw new LedgerError("Pajak Badan untuk tahun buku non-kalender belum didukung di Buku.");
  const later = pack.laterPosting[input.kind];
  if (later) throw new LedgerError(`Jurnal ${input.kind === "CURRENT" ? "pajak kini" : "pajak tangguhan"} sudah dicatat per ${formatDate(later)}. Catat perubahan di bulan itu atau sesudahnya.`);
  const lines = pack.proposals[input.kind];
  if (!lines.length) throw new LedgerError("Tidak ada selisih yang perlu dijurnal.");
  const cumulative = input.kind === "DEFERRED";
  const seen = await postedLines(db, input.entityId, input.kind, input.year, cumulative, pack.through);

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`tax:${input.entityId}:${input.year}`}, 0))::text`;
    const now = await postedLines(tx, input.entityId, input.kind, input.year, cumulative, pack.through);
    const same = now.size === seen.size && [...now].every(([k, v]) => seen.get(k) === v) && !(await postingAfter(tx, input.entityId, input.kind, input.year, pack.through));
    if (!same) throw new LedgerError("Jurnal pajak berubah sementara itu. Muat ulang halaman lalu coba lagi.");
    const ids = await templateAccounts(tx, input.clientId, lines.map((l) => l.code));
    const post: PostLine[] = lines.map((l) => (l.amount > 0n ? { accountId: ids.get(l.code)!, debit: l.amount } : { accountId: ids.get(l.code)!, credit: -l.amount }));
    const entity = await tx.entity.findUniqueOrThrow({ where: { id: input.entityId } });
    const taxYear = await tx.taxYear.upsert({ where: { entityId_year: { entityId: input.entityId, year: input.year } }, update: {}, create: { firmId: entity.firmId, clientId: input.clientId, entityId: input.entityId, year: input.year } });
    const label = formatPeriod(input.year, input.month);
    const entry = await postJournal(tx, {
      entityId: input.entityId,
      date: pack.through,
      kind: "ADJUSTMENT",
      memo: input.kind === "CURRENT" ? (pack.regime === "FINAL_UMKM" ? finalMemo(input.year, label, lines) : `PPh badan ${input.year} (estimasi s.d. ${label})`) : `Pajak tangguhan ${input.year} (s.d. ${label})`,
      lines: post,
      actorId: input.actorId,
    });
    await tx.taxPosting.create({ data: { firmId: entity.firmId, taxYearId: taxYear.id, kind: input.kind, entryId: entry.id, createdById: input.actorId ?? null } });
    return entry;
  });
}

/** The final regime's journal: its own tax, and the reversal of a normal-regime posting when the year switched. */
function finalMemo(year: number, label: string, lines: { code: string; amount: bigint }[]) {
  const own = lines.some((l) => l.code === ACCOUNT_CODES.FINAL_TAX);
  const reversal = lines.some((l) => l.code === ACCOUNT_CODES.CURRENT_TAX);
  if (own && reversal) return `PPh final PP 55/2022 ${year} (0,5% × peredaran bruto s.d. ${label}); membalik jurnal PPh badan skema normal`;
  if (reversal) return `Pembalikan PPh badan ${year}: skema final PP 55/2022`;
  return `PPh final PP 55/2022 ${year} (0,5% × peredaran bruto s.d. ${label})`;
}
