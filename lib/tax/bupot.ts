import type { Db } from "@/lib/db";
import { recordEvent } from "@/lib/audit";
import { formatPeriod, periodBounds } from "@/lib/format";
import { formatRupiah } from "@/lib/money";
import { packApplies } from "@/lib/tax/pack";
import { matchOneToOne } from "@/lib/tax/coretax-match";
import { BUPOT_KIND_LABEL, readBupot, type BupotDirection, type BupotKind } from "@/lib/tax/bupot-read";

/**
 * Bukti potong Unifikasi (I5d, accounting-rules 5k): Coretax slips against the withholding the books hold on bank lines (rule 5h) for the
 * same masa — *dibuat* against outgoing lines with PPh 23 / 4(2) / 22 withheld, *diterima* against incoming lines with withholding.
 * PPh 21 is not Unifikasi (e-Bupot 21/26). Evidence only: stored, matched and shown, never posted.
 */
export class BupotError extends Error {}

export const BUPOT_DIRECTION_LABEL: Record<BupotDirection, string> = { DIBUAT: "Bukti potong dibuat", DITERIMA: "Bukti potong diterima" };
const UNIFIKASI = ["PPH_23", "PPH_4_2", "PPH_22"] as const;

async function company(db: Db, clientId: string, entityId: string) {
  const e = await db.entity.findFirst({ where: { id: entityId, clientId }, select: { id: true, shortName: true, kind: true, functionalCurrency: true, client: { select: { firmId: true } } } });
  if (!e) throw new BupotError("Perusahaan tidak ditemukan di klien ini.");
  if (!packApplies(e)) throw new BupotError("Bukti potong Coretax hanya untuk badan usaha (PT/CV) dengan pembukuan Rupiah.");
  return e;
}

export type BupotImportResult = { direction: BupotDirection; created: number; updated: number; unchanged: number; masas: { year: number; month: number; count: number }[]; notes: string[] };

export async function importBupot(db: Db, input: { clientId: string; entityId: string; fileName: string; data: Buffer; actorId?: string | null }): Promise<BupotImportResult> {
  const e = await company(db, input.clientId, input.entityId);
  const read = await readBupot(input.fileName, input.data);
  return db.$transaction(async (tx) => {
    const existing = new Map((await tx.coretaxBupot.findMany({ where: { entityId: e.id, direction: read.direction, number: { in: read.rows.map((r) => r.number) } } })).map((b) => [b.number, b]));
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const masas = new Map<string, { year: number; month: number; count: number }>();
    for (const r of read.rows) {
      const k = `${r.year}-${r.month}`;
      masas.set(k, { year: r.year, month: r.month, count: (masas.get(k)?.count ?? 0) + 1 });
      const data = { date: r.date, year: r.year, month: r.month, npwp: r.npwp, name: r.name, kop: r.kop, kind: r.kind, dpp: r.dpp, pph: r.pph, status: r.status, counted: r.counted, fileName: input.fileName, sourceRef: r.sourceRef, importedById: input.actorId ?? null };
      const old = existing.get(r.number);
      if (!old) {
        await tx.coretaxBupot.create({ data: { ...data, firmId: e.client.firmId, clientId: input.clientId, entityId: e.id, direction: read.direction, number: r.number } });
        created++;
      } else if (old.status !== r.status || old.pph !== r.pph || old.dpp !== r.dpp || old.kind !== r.kind || old.year !== r.year || old.month !== r.month || +old.date !== +r.date) {
        await tx.coretaxBupot.update({ where: { id: old.id }, data });
        updated++;
      } else unchanged++;
    }
    const list = [...masas.values()].sort((a, b) => a.year - b.year || a.month - b.month);
    await recordEvent(tx, {
      clientId: input.clientId,
      entityId: e.id,
      kind: "BUKTI_POTONG",
      subject: `bupot:${e.id}:${read.direction}`,
      summary: `${BUPOT_DIRECTION_LABEL[read.direction]} ${e.shortName} dari ${input.fileName}: ${created} baru, ${updated} berubah (${list.map((m) => formatPeriod(m.year, m.month)).join(", ")})`,
      after: { fileName: input.fileName, created, updated, unchanged },
      actorId: input.actorId,
    });
    return { direction: read.direction, created, updated, unchanged, masas: list, notes: read.notes };
  });
}

export async function deleteBupot(db: Db, input: { clientId: string; entityId: string; direction: BupotDirection; year: number; month: number; actorId?: string | null }) {
  const e = await company(db, input.clientId, input.entityId);
  return db.$transaction(async (tx) => {
    const { count } = await tx.coretaxBupot.deleteMany({ where: { entityId: e.id, direction: input.direction, year: input.year, month: input.month } });
    await recordEvent(tx, {
      clientId: input.clientId,
      entityId: e.id,
      kind: "BUKTI_POTONG",
      subject: `bupot:${e.id}:${input.direction}`,
      summary: `${BUPOT_DIRECTION_LABEL[input.direction]} ${e.shortName} masa ${formatPeriod(input.year, input.month)} dihapus (${count} bukti potong)`,
      before: { count },
      actorId: input.actorId,
    });
    return count;
  });
}

export type BupotView = { id: string; number: string; date: Date; npwp: string | null; name: string; kop: string; kind: BupotKind; dpp: bigint; pph: bigint; status: string; sourceRef: string };
/** A withholding on a bank line of the masa. */
export type BookWht = { id: string; date: Date; kind: BupotKind; pph: bigint; description: string; contact: string | null; npwp: string | null; inReview: boolean };
export type BupotDirectionRecon = {
  direction: BupotDirection;
  imported: number;
  slipPph: bigint;
  bookPph: bigint;
  difference: bigint;
  status: "NONE" | "MATCH" | "DIFF";
  matched: { slip: BupotView; book: BookWht }[];
  /** Matched on the amount but filed as another kind (a slip for 4(2), the books withheld 23). */
  kindDiffers: { slip: BupotView; book: BookWht }[];
  unmatchedSlips: BupotView[];
  unmatchedBook: BookWht[];
  notCounted: BupotView[];
};
export type BupotRecon = { year: number; month: number; directions: BupotDirectionRecon[]; any: boolean };

export async function bupotRecon(db: Db, input: { clientId: string; entityId: string; year: number; month: number }): Promise<BupotRecon> {
  const { year, month } = input;
  const { start, end } = periodBounds(year, month);
  const all = await db.coretaxBupot.findMany({ where: { clientId: input.clientId, entityId: input.entityId, year, month }, orderBy: [{ date: "asc" }, { number: "asc" }] });
  const lines = await db.bankTransaction.findMany({
    where: { entityId: input.entityId, date: { gte: start, lte: end }, whtKind: { in: [...UNIFIKASI] }, whtAmount: { gt: 0n } },
    include: { contact: { select: { name: true, npwp: true } } },
    orderBy: [{ date: "asc" }, { rowNumber: "asc" }],
  });
  const directions: BupotDirectionRecon[] = [];
  for (const direction of ["DIBUAT", "DITERIMA"] as const) {
    const own = all.filter((b) => b.direction === direction);
    const view = (b: (typeof own)[number]): BupotView => ({ id: b.id, number: b.number, date: b.date, npwp: b.npwp, name: b.name, kop: b.kop, kind: b.kind as BupotKind, dpp: b.dpp, pph: b.pph, status: b.status, sourceRef: b.sourceRef });
    const counted = own.filter((b) => b.counted).map(view);
    const book: BookWht[] = lines
      .filter((l) => (direction === "DIBUAT" ? l.amount < 0n : l.amount > 0n))
      .map((l) => ({ id: l.id, date: l.date, kind: l.whtKind as BupotKind, pph: l.whtAmount, description: l.description, contact: l.contact?.name ?? null, npwp: l.contact?.npwp ?? null, inReview: l.status === "NEEDS_REVIEW" }));
    const m = matchOneToOne(
      counted.map((s) => ({ item: s, key: s.number, date: s.date, amount: s.pph, npwp: s.npwp, text: s.name })),
      book.map((b) => ({ item: b, key: b.id, date: b.date, amount: b.pph, npwp: b.npwp, text: `${b.contact ?? ""} ${b.description}` })),
    );
    const slipPph = counted.reduce((s, b) => s + b.pph, 0n);
    const bookPph = book.reduce((s, b) => s + b.pph, 0n);
    const difference = slipPph - bookPph;
    const pairs = m.matched.map((p) => ({ slip: p.doc, book: p.book }));
    const kindDiffers = pairs.filter((p) => p.slip.kind !== "LAINNYA" && p.slip.kind !== p.book.kind);
    directions.push({
      direction,
      imported: own.length,
      slipPph,
      bookPph,
      difference,
      // Withholding is typed in whole Rupiah on both sides: equal or not, no rounding allowance.
      status: own.length === 0 ? "NONE" : difference === 0n && kindDiffers.length === 0 && m.unmatchedDocs.length === 0 && m.unmatchedBook.length === 0 ? "MATCH" : "DIFF",
      matched: pairs,
      kindDiffers,
      unmatchedSlips: m.unmatchedDocs,
      unmatchedBook: m.unmatchedBook,
      notCounted: own.filter((b) => !b.counted).map(view),
    });
  }
  return { year, month, directions, any: all.length > 0 };
}

export function bupotNotes(r: BupotRecon): string[] {
  return r.directions
    .filter((d) => d.status === "DIFF")
    .map((d) => {
      const parts = [
        d.unmatchedSlips.length ? `${d.unmatchedSlips.length} bukti potong tanpa pemotongan di buku` : "",
        d.unmatchedBook.length ? `${d.unmatchedBook.length} pemotongan di buku tanpa bukti potong` : "",
        d.kindDiffers.length ? `${d.kindDiffers.length} beda jenis (${d.kindDiffers.map((p) => `${p.slip.number}: ${BUPOT_KIND_LABEL[p.slip.kind]} vs ${BUPOT_KIND_LABEL[p.book.kind]}`).join(", ")})` : "",
      ].filter(Boolean);
      return `${BUPOT_DIRECTION_LABEL[d.direction]}: PPh ${formatRupiah(d.slipPph)} vs buku ${formatRupiah(d.bookPph)}${parts.length ? `; ${parts.join(", ")}` : ""}.`;
    });
}
