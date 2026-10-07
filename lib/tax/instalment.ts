import type { Db } from "@/lib/db";
import { recordEvent } from "@/lib/audit";
import { LedgerError } from "@/lib/ledger/post";
import { dateOnly, formatPeriod } from "@/lib/format";
import { formatRupiah, parseMoney } from "@/lib/money";
import { packApplies } from "@/lib/tax/pack";

/**
 * PPh 25 angsuran (rule 5j): the monthly instalment from a masa onward, typed by the accountant from the last SPT, an SKP or a
 * pembetulan. The instalment of a masa is the latest one from on or before it; nothing is computed or posted here.
 */
export type Instalment = { id: string; from: Date; amount: bigint };

export async function instalments(db: Db, entityId: string): Promise<Instalment[]> {
  return db.taxInstalment.findMany({ where: { entityId }, orderBy: { from: "asc" }, select: { id: true, from: true, amount: true } });
}

/** The instalment in force for a masa, or null when none was set from on or before it. */
export function instalmentFor(list: Instalment[], year: number, month: number): Instalment | null {
  const at = +dateOnly(year, month, 1);
  let found: Instalment | null = null;
  for (const i of list) if (+i.from <= at) found = i;
  return found;
}

async function company(db: Db, clientId: string, entityId: string) {
  const entity = await db.entity.findFirst({ where: { id: entityId, clientId } });
  if (!entity) throw new LedgerError("Perusahaan tidak ditemukan di klien ini.");
  if (!packApplies(entity)) throw new LedgerError("Angsuran PPh 25 hanya untuk badan usaha (PT/CV) dengan pembukuan Rupiah.");
  return entity;
}

/** Sets the instalment from a masa ("YYYY-MM"); a second one for the same masa replaces it. */
export async function setInstalment(db: Db, input: { clientId: string; entityId: string; from: string; amount: string; actorId?: string | null }) {
  const entity = await company(db, input.clientId, input.entityId);
  const m = /^(\d{4})-(\d{2})$/.exec(input.from.trim());
  if (!m || +m[2] < 1 || +m[2] > 12) throw new LedgerError("Pilih masa mulai berlakunya angsuran.");
  if (!input.amount.trim()) throw new LedgerError("Isi angsuran PPh 25 per bulan. Isi 0 untuk nihil.");
  const amount = parseMoney(input.amount, "IDR");
  if (amount < 0n) throw new LedgerError("Angsuran PPh 25 tidak boleh negatif. Isi 0 untuk nihil.");
  const from = dateOnly(+m[1], +m[2], 1);
  return db.$transaction(async (tx) => {
    const before = await tx.taxInstalment.findUnique({ where: { entityId_from: { entityId: entity.id, from } } });
    const row = await tx.taxInstalment.upsert({
      where: { entityId_from: { entityId: entity.id, from } },
      update: { amount, createdById: input.actorId ?? null },
      create: { firmId: entity.firmId, clientId: input.clientId, entityId: entity.id, from, amount, createdById: input.actorId ?? null },
    });
    await recordEvent(tx, {
      clientId: input.clientId,
      entityId: entity.id,
      kind: "PPH25",
      subject: row.id,
      summary: `Angsuran PPh 25 ${entity.shortName} mulai masa ${formatPeriod(+m[1], +m[2])}: ${formatRupiah(amount)}${before ? ` (sebelumnya ${formatRupiah(before.amount)})` : ""}`,
      before: before ? { amount: before.amount.toString() } : undefined,
      after: { amount: amount.toString() },
      actorId: input.actorId,
    });
    return row;
  });
}

export async function deleteInstalment(db: Db, input: { clientId: string; id: string; actorId?: string | null }) {
  const row = await db.taxInstalment.findFirst({ where: { id: input.id, clientId: input.clientId } });
  if (!row) throw new LedgerError("Angsuran PPh 25 tidak ditemukan.");
  const entity = await company(db, input.clientId, row.entityId);
  await db.$transaction(async (tx) => {
    await tx.taxInstalment.delete({ where: { id: row.id } });
    await recordEvent(tx, {
      clientId: input.clientId,
      entityId: entity.id,
      kind: "PPH25",
      subject: row.id,
      summary: `Angsuran PPh 25 ${entity.shortName} mulai masa ${formatPeriod(row.from.getUTCFullYear(), row.from.getUTCMonth() + 1)} dihapus (${formatRupiah(row.amount)})`,
      before: { amount: row.amount.toString() },
      actorId: input.actorId,
    });
  });
}
