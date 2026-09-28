import type { Db } from "@/lib/db";
import type { InvoiceDirection } from "@/lib/generated/prisma/enums";
import { LedgerError, postJournal, type PostLine } from "@/lib/ledger/post";
import { ACCOUNT_CODES } from "@/lib/coa/template";
import { dateOnly, formatDate, formatPeriod } from "@/lib/format";
import { closeLock } from "@/lib/adjust/schedules";
import { parseMoney, PPN_EFFECTIVE_PERCENT } from "@/lib/money";

/**
 * Receivable/payable subledger (accounting-rules 5c). An invoice is recorded by the accountant and posts its journal through
 * postJournal() (kind INVOICE): sales Dr receivable / Cr revenue + PPN Keluaran, purchases Dr expense or asset + PPN Masukan / Cr
 * payable. A Saldo Awal invoice posts nothing: the opening entry already holds its balance.
 */
export const DIRECTION_LABEL: Record<InvoiceDirection, string> = { SALES: "Piutang", PURCHASE: "Utang" };
export const DEFAULT_AR_AP: Record<InvoiceDirection, string> = { SALES: "1130", PURCHASE: "2110" };
const AR_AP_LINE: Record<InvoiceDirection, string> = { SALES: "PIUTANG_USAHA", PURCHASE: "UTANG_USAHA" };

export type InvoiceInput = {
  clientId: string;
  entityId: string;
  direction: InvoiceDirection;
  contactName: string;
  contactNpwp?: string | null;
  number: string;
  /** YYYY-MM-DD */
  issueDate: string;
  /** YYYY-MM-DD; default the issue date (due immediately). */
  dueDate?: string | null;
  description?: string;
  /** Major units of the entity's functional currency (rule 6). */
  dpp: string;
  ppn?: string | null;
  counterCode: string;
  arApCode?: string | null;
  /** An open item at the opening date: recorded without a journal. */
  opening?: boolean;
  actorId?: string | null;
};

/** PPN at the effective rate (rule 8), rounded half up — a prefill; the tax invoice's own amount wins. */
export function ppnFor(dpp: bigint): bigint {
  return (2n * dpp * PPN_EFFECTIVE_PERCENT + 100n) / 200n;
}

function parseDay(s: string, what: string): Date {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? dateOnly(Number(m[1]), Number(m[2]), Number(m[3])) : null;
  if (!d || d.getUTCMonth() + 1 !== Number(m![2])) throw new LedgerError(`${what} tidak valid.`);
  return d;
}

export async function createInvoice(db: Db, input: InvoiceInput) {
  const entity = await db.entity.findFirst({ where: { id: input.entityId, clientId: input.clientId } });
  if (!entity) throw new LedgerError("Pilih entitas.");
  const sales = input.direction === "SALES";
  if (!sales && input.direction !== "PURCHASE") throw new LedgerError("Pilih jenis: piutang atau utang.");
  const number = input.number.trim();
  const contactName = input.contactName.trim().replace(/\s+/g, " ");
  if (!number) throw new LedgerError("Isi nomor faktur.");
  if (!contactName) throw new LedgerError(sales ? "Isi nama pelanggan." : "Isi nama pemasok.");
  const issueDate = parseDay(input.issueDate, "Tanggal faktur");
  const dueDate = input.dueDate?.trim() ? parseDay(input.dueDate, "Tanggal jatuh tempo") : issueDate;
  if (+dueDate < +issueDate) throw new LedgerError("Jatuh tempo tidak boleh sebelum tanggal faktur.");
  const cur = entity.functionalCurrency;
  const dpp = parseMoney(input.dpp, cur);
  const ppn = input.ppn?.trim() ? parseMoney(input.ppn, cur) : 0n;
  if (dpp < 0n || ppn < 0n) throw new LedgerError("DPP dan PPN tidak boleh negatif.");
  const total = dpp + ppn;
  if (total <= 0n) throw new LedgerError("Nilai faktur harus lebih dari nol.");

  const accounts = await db.account.findMany({ where: { clientId: input.clientId } });
  const byCode = (code: string) => accounts.find((a) => a.code === code);
  const arAp = byCode(input.arApCode?.trim() || DEFAULT_AR_AP[input.direction]);
  if (!arAp || arAp.fsLine !== AR_AP_LINE[input.direction]) throw new LedgerError(sales ? "Akun piutang harus akun Piutang Usaha." : "Akun utang harus akun Utang Usaha.");
  const counter = byCode(input.counterCode);
  const counterOk = counter && !counter.isBank && !counter.isSuspense && !counter.isClearing && !counter.isIntercompany && counter.id !== arAp.id && (sales ? counter.type === "PENDAPATAN" : counter.type === "BEBAN" || counter.type === "ASET");
  if (!counterOk) throw new LedgerError(sales ? "Pilih akun pendapatan untuk faktur penjualan." : "Pilih akun beban atau aset untuk tagihan pembelian (bukan akun bank).");
  const ppnAccount = ppn > 0n ? byCode(sales ? ACCOUNT_CODES.PPN_KELUARAN : ACCOUNT_CODES.PPN_MASUKAN) : null;
  if (ppn > 0n && !ppnAccount) throw new LedgerError(`Akun ${sales ? ACCOUNT_CODES.PPN_KELUARAN : ACCOUNT_CODES.PPN_MASUKAN} tidak ada di bagan akun klien.`);

  // A Saldo Awal item enters the subledger at the opening date; without a journal, postJournal's period check doesn't run, so the
  // month is checked here (under the close lock, inside the write below).
  let openingMonth: { year: number; month: number } | null = null;
  if (input.opening) {
    const opening = await db.journalEntry.findFirst({ where: { entityId: entity.id, kind: "OPENING" }, orderBy: { date: "asc" } });
    if (!opening) throw new LedgerError("Catat Saldo Awal entitas ini dulu; faktur saldo awal adalah rincian saldonya.");
    if (+issueDate > +opening.date) throw new LedgerError(`Faktur saldo awal harus bertanggal paling lambat ${formatDate(opening.date)} (tanggal Saldo Awal).`);
    openingMonth = { year: opening.date.getUTCFullYear(), month: opening.date.getUTCMonth() + 1 };
  }

  const description = input.description?.trim() || (sales ? `Penjualan kepada ${contactName}` : `Pembelian dari ${contactName}`);
  try {
    return await db.$transaction(async (tx) => {
      if (openingMonth) {
        await closeLock(tx, input.clientId);
        // It stays in every later month's list, so any locked month from the opening on would change after the fact.
        const { year: y, month: m } = openingMonth;
        const locked = await tx.period.findFirst({ where: { clientId: input.clientId, status: "LOCKED", OR: [{ year: { gt: y } }, { year: y, month: { gte: m } }] }, orderBy: [{ year: "asc" }, { month: "asc" }] });
        if (locked) throw new LedgerError(`${formatPeriod(locked.year, locked.month)} sudah dikunci, dan rincian saldo awal mengubah daftar ${sales ? "piutang" : "utang"} bulan itu. Buka kunci bulan itu dulu.`);
      }
      const contact = await tx.contact.upsert({
        where: { clientId_name: { clientId: input.clientId, name: contactName } },
        update: input.contactNpwp?.trim() ? { npwp: input.contactNpwp.trim() } : {},
        create: { firmId: entity.firmId, clientId: input.clientId, name: contactName, npwp: input.contactNpwp?.trim() || null },
      });
      let entryId: string | null = null;
      if (!input.opening) {
        const lines: PostLine[] = sales
          ? [{ accountId: arAp.id, debit: total }, ...(dpp > 0n ? [{ accountId: counter!.id, credit: dpp }] : []), ...(ppn > 0n ? [{ accountId: ppnAccount!.id, credit: ppn }] : [])]
          : [...(dpp > 0n ? [{ accountId: counter!.id, debit: dpp }] : []), ...(ppn > 0n ? [{ accountId: ppnAccount!.id, debit: ppn }] : []), { accountId: arAp.id, credit: total }];
        const memo = `${sales ? "Faktur" : "Tagihan"} ${number} · ${contactName}`;
        entryId = (await postJournal(tx, { entityId: entity.id, date: issueDate, kind: "INVOICE", memo, lines, actorId: input.actorId })).id;
      }
      return tx.invoice.create({
        data: {
          firmId: entity.firmId,
          clientId: input.clientId,
          entityId: entity.id,
          contactId: contact.id,
          direction: input.direction,
          number,
          issueDate,
          dueDate,
          description,
          dpp,
          ppn,
          total,
          counterAccountId: counter!.id,
          arApAccountId: arAp.id,
          opening: !!input.opening,
          entryId,
          createdById: input.actorId ?? null,
        },
      });
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new LedgerError(`Nomor ${number} sudah dipakai untuk ${sales ? "faktur" : "tagihan"} lain entitas ini.`);
    throw e;
  }
}
