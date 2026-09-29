import type { Db, Tx } from "@/lib/db";
import type { TaxPostingKind } from "@/lib/generated/prisma/enums";
import { LedgerError, postJournal, type PostLine } from "@/lib/ledger/post";
import { COA_TEMPLATE } from "@/lib/coa/template";
import { formatPeriod } from "@/lib/format";
import { postedLines, taxPack } from "@/lib/tax/pack";

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
  const lines = pack.proposals[input.kind];
  if (!lines.length) throw new LedgerError("Tidak ada selisih yang perlu dijurnal.");
  const cumulative = input.kind === "DEFERRED";
  const seen = await postedLines(db, input.entityId, input.kind, input.year, cumulative);

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`tax:${input.entityId}:${input.year}`}, 0))::text`;
    const now = await postedLines(tx, input.entityId, input.kind, input.year, cumulative);
    const same = now.size === seen.size && [...now].every(([k, v]) => seen.get(k) === v);
    if (!same) throw new LedgerError("Jurnal pajak berubah sementara itu. Muat ulang halaman lalu coba lagi.");
    const ids = await accountIds(tx, input.clientId, lines.map((l) => l.code));
    const post: PostLine[] = lines.map((l) => (l.amount > 0n ? { accountId: ids.get(l.code)!, debit: l.amount } : { accountId: ids.get(l.code)!, credit: -l.amount }));
    const entity = await tx.entity.findUniqueOrThrow({ where: { id: input.entityId } });
    const taxYear = await tx.taxYear.upsert({ where: { entityId_year: { entityId: input.entityId, year: input.year } }, update: {}, create: { firmId: entity.firmId, clientId: input.clientId, entityId: input.entityId, year: input.year } });
    const label = formatPeriod(input.year, input.month);
    const entry = await postJournal(tx, {
      entityId: input.entityId,
      date: pack.through,
      kind: "ADJUSTMENT",
      memo: input.kind === "CURRENT" ? `PPh badan ${input.year} (estimasi s.d. ${label})` : `Pajak tangguhan ${input.year} (s.d. ${label})`,
      lines: post,
      actorId: input.actorId,
    });
    await tx.taxPosting.create({ data: { firmId: entity.firmId, taxYearId: taxYear.id, kind: input.kind, entryId: entry.id, createdById: input.actorId ?? null } });
    return entry;
  });
}

/**
 * The client's accounts for the codes, creating the pack's template accounts (1181, 1270, 2146, 2320, 8110) on first use when the code
 * is free. A code the client uses for something else is refused, naming it, rather than posting tax into it.
 */
async function accountIds(tx: Tx, clientId: string, codes: string[]) {
  const client = await tx.client.findUniqueOrThrow({ where: { id: clientId } });
  const out = new Map<string, string>();
  for (const code of [...new Set(codes)]) {
    const seed = COA_TEMPLATE.find((a) => a.code === code);
    const found = await tx.account.findFirst({ where: { clientId, code } });
    if (found) {
      if (seed && (found.fsLine !== seed.fsLine || found.type !== seed.type)) throw new LedgerError(`Akun ${code} dipakai untuk "${found.name}", bukan ${seed.name}. Ubah kode akun itu dulu.`);
      out.set(code, found.id);
    } else if (seed) {
      out.set(code, (await tx.account.create({ data: { ...seed, firmId: client.firmId, clientId } })).id);
    } else throw new LedgerError(`Akun ${code} tidak ada di bagan akun klien.`);
  }
  return out;
}
