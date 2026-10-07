import type { Db } from "@/lib/db";
import { recordEvent } from "@/lib/audit";
import { formatPeriod, periodBounds } from "@/lib/format";
import { formatRupiah } from "@/lib/money";
import { packApplies } from "@/lib/tax/pack";
import { readFaktur, type FakturDirection } from "@/lib/tax/faktur-read";

/**
 * Ekualisasi PPN (I5c, accounting-rules 5j): faktur from a Coretax export against the PPN the books hold for the same masa — keluaran on
 * 2130, masukan on 1150. Faktur are evidence: stored, matched and shown, never posted. Matching is one to one on the exact PPN amount
 * (rule 8: bank-derived PPN is an estimate, so a receipt net of withholding shows as a difference to look at).
 */
export class FakturError extends Error {}

const ACCOUNT: Record<FakturDirection, string> = { KELUARAN: "2130", MASUKAN: "1150" };
export const DIRECTION_LABEL: Record<FakturDirection, string> = { KELUARAN: "Faktur keluaran", MASUKAN: "Faktur masukan" };

async function company(db: Db, clientId: string, entityId: string) {
  const e = await db.entity.findFirst({ where: { id: entityId, clientId }, select: { id: true, name: true, shortName: true, kind: true, functionalCurrency: true, client: { select: { firmId: true } } } });
  if (!e) throw new FakturError("Perusahaan tidak ditemukan di klien ini.");
  if (!packApplies(e)) throw new FakturError("Faktur Coretax hanya untuk badan usaha (PT/CV) dengan pembukuan Rupiah.");
  return e;
}

export type FakturImportResult = { direction: FakturDirection; created: number; updated: number; unchanged: number; masas: { year: number; month: number; count: number }[]; notes: string[] };

/** Reads one Coretax export and stores its faktur for the company; a faktur already stored is updated (its status may have changed). */
export async function importFaktur(db: Db, input: { clientId: string; entityId: string; fileName: string; data: Buffer; actorId?: string | null }): Promise<FakturImportResult> {
  const e = await company(db, input.clientId, input.entityId);
  const read = await readFaktur(input.fileName, input.data);
  return db.$transaction(async (tx) => {
    const existing = new Map(
      (await tx.coretaxFaktur.findMany({ where: { entityId: e.id, direction: read.direction, number: { in: read.rows.map((r) => r.number) } } })).map((f) => [f.number, f]),
    );
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const masas = new Map<string, { year: number; month: number; count: number }>();
    for (const r of read.rows) {
      const k = `${r.year}-${r.month}`;
      masas.set(k, { year: r.year, month: r.month, count: (masas.get(k)?.count ?? 0) + 1 });
      const data = { date: r.date, year: r.year, month: r.month, npwp: r.npwp, name: r.name, dpp: r.dpp, ppn: r.ppn, status: r.status, counted: r.counted, uncredited: r.uncredited, fileName: input.fileName, sourceRef: r.sourceRef, importedById: input.actorId ?? null };
      const old = existing.get(r.number);
      if (!old) {
        await tx.coretaxFaktur.create({ data: { ...data, firmId: e.client.firmId, clientId: input.clientId, entityId: e.id, direction: read.direction, number: r.number } });
        created++;
      } else if (old.status !== r.status || old.ppn !== r.ppn || old.dpp !== r.dpp || old.year !== r.year || old.month !== r.month || +old.date !== +r.date || old.counted !== r.counted) {
        await tx.coretaxFaktur.update({ where: { id: old.id }, data });
        updated++;
      } else unchanged++;
    }
    const list = [...masas.values()].sort((a, b) => a.year - b.year || a.month - b.month);
    await recordEvent(tx, {
      clientId: input.clientId,
      entityId: e.id,
      kind: "FAKTUR",
      subject: `faktur:${e.id}:${read.direction}`,
      summary: `${DIRECTION_LABEL[read.direction]} ${e.shortName} dari ${input.fileName}: ${created} baru, ${updated} berubah (${list.map((m) => formatPeriod(m.year, m.month)).join(", ")})`,
      after: { fileName: input.fileName, created, updated, unchanged },
      actorId: input.actorId,
    });
    return { direction: read.direction, created, updated, unchanged, masas: list, notes: read.notes };
  });
}

/** Removes one direction's faktur of one masa, so a wrong file can be imported again. */
export async function deleteFaktur(db: Db, input: { clientId: string; entityId: string; direction: FakturDirection; year: number; month: number; actorId?: string | null }) {
  const e = await company(db, input.clientId, input.entityId);
  return db.$transaction(async (tx) => {
    const { count } = await tx.coretaxFaktur.deleteMany({ where: { entityId: e.id, direction: input.direction, year: input.year, month: input.month } });
    await recordEvent(tx, {
      clientId: input.clientId,
      entityId: e.id,
      kind: "FAKTUR",
      subject: `faktur:${e.id}:${input.direction}`,
      summary: `${DIRECTION_LABEL[input.direction]} ${e.shortName} masa ${formatPeriod(input.year, input.month)} dihapus (${count} faktur)`,
      before: { count },
      actorId: input.actorId,
    });
    return count;
  });
}

export type FakturView = { id: string; number: string; date: Date; npwp: string | null; name: string; dpp: bigint; ppn: bigint; status: string; sourceRef: string; fileName: string };
/** A source of PPN in the books for the masa: one bank line or one invoice (its void netted), with its PPN on the tax account. */
export type BookPpn = { key: string; date: Date; ppn: bigint; label: string; kind: "BANK" | "INVOICE" | "JOURNAL"; bankTxId?: string; invoiceId?: string; npwp?: string | null };
export type DirectionRecon = {
  direction: FakturDirection;
  account: string;
  /** Every faktur of the masa as imported, counted or not. */
  imported: number;
  fakturPpn: bigint;
  bookPpn: bigint;
  difference: bigint;
  status: "NONE" | "MATCH" | "DIFF";
  matched: { faktur: FakturView; book: BookPpn }[];
  unmatchedFaktur: FakturView[];
  unmatchedBook: BookPpn[];
  notCounted: FakturView[];
  uncredited: FakturView[];
};
export type FakturRecon = { year: number; month: number; directions: DirectionRecon[]; any: boolean };

/** NPWP digits; a company's 16-digit NPWP (since 2024) is "0" + its 15-digit one, so both read the same. */
const digits = (s: string | null | undefined) => {
  const d = (s ?? "").replace(/\D/g, "");
  return d.length === 16 && d.startsWith("0") ? d.slice(1) : d;
};
const NAME_NOISE = new Set(["PT", "CV", "TBK", "UD", "PERSERO", "INDONESIA", "TRSF", "TRANSFER", "DARI", "BANKING", "KE", "DB", "CR"]);
const words = (s: string) => new Set(s.toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length >= 4 && !NAME_NOISE.has(w)));

/** Book PPN sources of the masa on the direction's account: net per bank line / invoice (a void nets its invoice), positive only. */
async function bookPpn(db: Db, entityId: string, direction: FakturDirection, year: number, month: number): Promise<BookPpn[]> {
  const { start, end } = periodBounds(year, month);
  const lines = await db.journalLine.findMany({
    where: { entityId, date: { gte: start, lte: end }, account: { code: ACCOUNT[direction] }, entry: { kind: { not: "OPENING" } } },
    select: {
      debit: true,
      credit: true,
      date: true,
      entry: {
        select: {
          id: true,
          memo: true,
          bankTransactionId: true,
          bankTransaction: { select: { id: true, description: true, amount: true, date: true } },
          invoice: { select: { id: true, number: true, issueDate: true, contact: { select: { name: true, npwp: true } } } },
          voidedInvoice: { select: { id: true, number: true, issueDate: true, contact: { select: { name: true, npwp: true } } } },
        },
      },
    },
  });
  const by = new Map<string, BookPpn>();
  for (const l of lines) {
    const signed = direction === "KELUARAN" ? l.credit - l.debit : l.debit - l.credit;
    const bt = l.entry.bankTransaction;
    // A remittance (money out to the tax account) is a payment, not PPN of the masa; a refund the same the other way.
    if (bt && (direction === "KELUARAN" ? bt.amount < 0n : bt.amount > 0n)) continue;
    const inv = l.entry.invoice ?? l.entry.voidedInvoice;
    const key = bt ? `bank:${bt.id}` : inv ? `inv:${inv.id}` : `je:${l.entry.id}`;
    const cur = by.get(key);
    if (cur) {
      cur.ppn += signed;
      continue;
    }
    by.set(
      key,
      bt
        ? { key, date: bt.date, ppn: signed, label: bt.description, kind: "BANK", bankTxId: bt.id }
        : inv
          ? { key, date: inv.issueDate, ppn: signed, label: `${inv.number} · ${inv.contact.name}`, kind: "INVOICE", invoiceId: inv.id, npwp: inv.contact.npwp }
          : { key, date: l.date, ppn: signed, label: l.entry.memo ?? "Jurnal", kind: "JOURNAL" },
    );
  }
  return [...by.values()].filter((b) => b.ppn > 0n).sort((a, b) => +a.date - +b.date || a.key.localeCompare(b.key));
}

/** One to one on the exact PPN: the same NPWP first, then a shared name word, then the earliest date. */
function match(faktur: FakturView[], book: BookPpn[]) {
  const free = new Set(book.map((b) => b.key));
  const matched: { faktur: FakturView; book: BookPpn }[] = [];
  const unmatchedFaktur: FakturView[] = [];
  for (const f of [...faktur].sort((a, b) => +a.date - +b.date || a.number.localeCompare(b.number))) {
    const fw = words(f.name);
    const score = (b: BookPpn) => (digits(f.npwp) && digits(f.npwp) === digits(b.npwp) ? 2 : [...words(b.label)].some((w) => fw.has(w)) ? 1 : 0);
    const best = book
      .filter((b) => free.has(b.key) && b.ppn === f.ppn)
      .sort((a, b) => score(b) - score(a) || Math.abs(+a.date - +f.date) - Math.abs(+b.date - +f.date))[0];
    if (best) {
      free.delete(best.key);
      matched.push({ faktur: f, book: best });
    } else unmatchedFaktur.push(f);
  }
  return { matched, unmatchedFaktur, unmatchedBook: book.filter((b) => free.has(b.key)) };
}

export async function fakturRecon(db: Db, input: { clientId: string; entityId: string; year: number; month: number }): Promise<FakturRecon> {
  const { year, month } = input;
  const all = await db.coretaxFaktur.findMany({ where: { clientId: input.clientId, entityId: input.entityId, year, month }, orderBy: [{ date: "asc" }, { number: "asc" }] });
  const directions: DirectionRecon[] = [];
  for (const direction of ["KELUARAN", "MASUKAN"] as const) {
    const own = all.filter((f) => f.direction === direction);
    const view = (f: (typeof own)[number]): FakturView => ({ id: f.id, number: f.number, date: f.date, npwp: f.npwp, name: f.name, dpp: f.dpp, ppn: f.ppn, status: f.status, sourceRef: f.sourceRef, fileName: f.fileName });
    const counted = own.filter((f) => f.counted).map(view);
    const book = await bookPpn(db, input.entityId, direction, year, month);
    const fakturPpn = counted.reduce((s, f) => s + f.ppn, 0n);
    const bookTotal = book.reduce((s, b) => s + b.ppn, 0n);
    const difference = fakturPpn - bookTotal;
    const m = match(counted, book);
    // Rp 1 per faktur is rounding between the faktur and an amount split from a bank line.
    const tolerance = BigInt(Math.max(counted.length, 1));
    directions.push({
      direction,
      account: ACCOUNT[direction],
      imported: own.length,
      fakturPpn,
      bookPpn: bookTotal,
      difference,
      status: own.length === 0 ? "NONE" : (difference < 0n ? -difference : difference) <= tolerance ? "MATCH" : "DIFF",
      ...m,
      notCounted: own.filter((f) => !f.counted && !f.uncredited).map(view),
      uncredited: own.filter((f) => f.uncredited).map(view),
    });
  }
  return { year, month, directions, any: all.length > 0 };
}

/** One sentence per direction that differs, for the close control and the page banner. */
export function fakturNotes(r: FakturRecon): string[] {
  return r.directions
    .filter((d) => d.status === "DIFF")
    .map((d) => {
      const parts = [
        d.unmatchedFaktur.length ? `${d.unmatchedFaktur.length} faktur belum ada di buku` : "",
        d.unmatchedBook.length ? `${d.unmatchedBook.length} PPN di buku tanpa faktur` : "",
      ].filter(Boolean);
      return `${DIRECTION_LABEL[d.direction]}: PPN faktur ${formatRupiah(d.fakturPpn)} vs buku ${formatRupiah(d.bookPpn)} (selisih ${formatRupiah(d.difference < 0n ? -d.difference : d.difference)})${parts.length ? `; ${parts.join(", ")}` : ""}.`;
    });
}
