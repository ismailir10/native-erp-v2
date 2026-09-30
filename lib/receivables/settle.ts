import type { Db, Tx } from "@/lib/db";
import { LedgerError } from "@/lib/ledger/post";
import { reviewTransactionTx, setWithholdingTx } from "@/lib/review";
import type { WithholdingKind } from "@/lib/generated/prisma/enums";
import { checkWithholding } from "@/lib/tax/withholding";
import { formatPeriod } from "@/lib/format";
import { formatMoney, parseMoney } from "@/lib/money";

/**
 * Settlements (accounting-rules 5c): a bank line settles (part of) an invoice. The bank line already moved the GL when it was
 * classified to the invoice's receivable/payable account, so a settlement is a subledger link only — no journal. Σ per invoice ≤
 * its total and Σ per bank line ≤ its amount, checked under row locks. A line not on that account yet is first reclassified through
 * the reviewer's writer (rule 3: RECLASS of the difference + Memory) in the same transaction.
 */

type SettleInput = {
  clientId: string;
  invoiceId: string;
  bankTransactionId: string;
  /** Major units of cash from the bank line; default the most both can take. */
  amount?: string | null;
  /**
   * Major units of the invoice paid as withheld tax (not cash). Default: the shortfall when this settlement closes the invoice and the
   * shortfall is within the invoice's expected withholding; else none. "0" = paid in full, nothing withheld.
   */
  withheld?: string | null;
  /** The tax, when the invoice doesn't name one. */
  whtKind?: WithholdingKind | null;
  actorId?: string | null;
};

const abs = (v: bigint) => (v < 0n ? -v : v);
/** Cash a bank line has already given to invoices: what they cleared less what was tax. */
const cashUsed = (xs: { amount: bigint; withheld: bigint }[]) => xs.reduce((s, x) => s + x.amount - x.withheld, 0n);
const monthKey = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth() + 1;

async function lockedMonths(db: Db | Tx, clientId: string) {
  return new Set((await db.period.findMany({ where: { clientId, status: "LOCKED" }, select: { year: true, month: true } })).map((p) => p.year * 12 + p.month));
}

async function load(tx: Tx, input: SettleInput) {
  // Lock both rows: two clicks settling the same invoice or the same receipt serialise here.
  await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${input.invoiceId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "BankTransaction" WHERE id = ${input.bankTransactionId} FOR UPDATE`;
  const invoice = await tx.invoice.findFirst({ where: { id: input.invoiceId, clientId: input.clientId }, include: { arApAccount: true, entity: true, settlements: { select: { amount: true, withheld: true } } } });
  if (!invoice) throw new LedgerError("Faktur tidak ditemukan.");
  const t = await tx.bankTransaction.findFirst({ where: { id: input.bankTransactionId, entityId: invoice.entityId }, include: { settlements: { select: { amount: true, withheld: true } } } });
  if (!t) throw new LedgerError("Mutasi bank tidak ditemukan untuk entitas faktur ini.");
  const sales = invoice.direction === "SALES";
  if (t.direction !== (sales ? "IN" : "OUT")) throw new LedgerError(sales ? "Pelunasan piutang harus uang masuk." : "Pembayaran utang harus uang keluar.");
  if ((await lockedMonths(tx, input.clientId)).has(monthKey(t.date))) throw new LedgerError(`${formatPeriod(t.date.getUTCFullYear(), t.date.getUTCMonth() + 1)} sudah ditutup. Buka periode dulu untuk mencocokkan mutasi ini.`);
  return { invoice, t };
}

async function settleTx(tx: Tx, input: SettleInput) {
  const { invoice, t } = await load(tx, input);
  if (t.status === "NEEDS_REVIEW" || t.accountCode !== invoice.arApAccount.code) {
    throw new LedgerError(`Mutasi ini belum dicatat ke ${invoice.arApAccount.code} ${invoice.arApAccount.name}. Klasifikasikan dulu, atau pakai "Klasifikasikan lalu cocokkan".`);
  }
  const cur = invoice.entity.functionalCurrency;
  const open = invoice.total - invoice.settlements.reduce((s, x) => s + x.amount, 0n);
  const free = abs(t.amount) - cashUsed(t.settlements);
  if (open <= 0n) throw new LedgerError(`${invoice.number} sudah lunas.`);
  if (free <= 0n) throw new LedgerError("Mutasi ini sudah habis dicocokkan ke faktur lain.");
  const explicitWht = input.withheld?.trim() ? parseMoney(input.withheld, cur) : null;
  if (explicitWht !== null && explicitWht < 0n) throw new LedgerError("Pemotongan pajak tidak boleh negatif.");
  // Cash: what was asked, else the most both can take (less the expected withholding when that is what closes the invoice).
  const expected = invoice.whtAmount - invoice.settlements.reduce((s, x) => s + x.withheld, 0n);
  let cash: bigint;
  if (input.amount?.trim()) cash = parseMoney(input.amount, cur);
  else if (explicitWht !== null) cash = open - explicitWht < free ? open - explicitWht : free;
  else cash = open < free ? open : free;
  if (cash <= 0n) throw new LedgerError("Nominal pencocokan harus lebih dari nol.");
  if (cash > free) throw new LedgerError(`Melebihi sisa mutasi yang belum dicocokkan (${formatMoney(free, cur)}).`);
  const shortfall = open - cash;
  const withheld = explicitWht ?? (shortfall > 0n && expected > 0n && shortfall <= expected ? shortfall : 0n);
  const amount = cash + withheld;
  if (amount > open) throw new LedgerError(`Melebihi sisa ${invoice.number} (${formatMoney(open, cur)}).`);
  const exists = await tx.invoiceSettlement.findUnique({ where: { invoiceId_bankTransactionId: { invoiceId: invoice.id, bankTransactionId: t.id } } });
  if (exists) throw new LedgerError("Mutasi ini sudah dicocokkan ke faktur ini. Hapus pencocokannya dulu untuk mengubah nominal.");
  const created = await tx.invoiceSettlement.create({ data: { firmId: invoice.firmId, invoiceId: invoice.id, bankTransactionId: t.id, amount, withheld, createdById: input.actorId ?? null } });
  if (withheld > 0n) {
    // The tax leg goes on the bank line's classification side (rule 3: a RECLASS of the difference), so the payable/receivable account
    // moves by the gross the invoice was cleared by.
    const kind = invoice.whtKind ?? input.whtKind;
    if (!kind) throw new LedgerError("Pilih jenis pajak yang dipotong.");
    if (t.whtKind && t.whtKind !== kind) throw new LedgerError(`Mutasi ini sudah mencatat pemotongan ${t.whtKind.replace("PPH_", "PPh ").replace("4_2", "4(2)")} dari jenis lain.`);
    await setWithholdingTx(tx, t.id, checkWithholding({ kind, amount: t.whtAmount + withheld }, t.direction), input.actorId);
  }
  return created;
}

export async function settle(db: Db, input: SettleInput) {
  return db.$transaction((tx) => settleTx(tx, input));
}

/** One click for a line still in review or on another account: classify it to the invoice's account (reviewer's writer), then settle. */
export async function settleWithReclass(db: Db, input: SettleInput) {
  return db.$transaction(async (tx) => {
    const { invoice, t } = await load(tx, input);
    if (t.status === "NEEDS_REVIEW" || t.accountCode !== invoice.arApAccount.code) {
      // The reviewer's writer refuses to move a line away from invoices it already settles on another account (one line, one account).
      await reviewTransactionTx(tx, { bankTxId: t.id, accountCode: invoice.arApAccount.code, taxTag: null, actorId: input.actorId });
    }
    return settleTx(tx, input);
  });
}

export async function unsettle(db: Db, input: { clientId: string; settlementId: string }) {
  const s = await db.invoiceSettlement.findFirst({ where: { id: input.settlementId, invoice: { clientId: input.clientId } }, include: { bankTransaction: { select: { date: true, whtKind: true, whtAmount: true } } } });
  if (!s) throw new LedgerError("Pencocokan tidak ditemukan.");
  if ((await lockedMonths(db, input.clientId)).has(monthKey(s.bankTransaction.date))) throw new LedgerError("Periode mutasi ini sudah ditutup. Buka periode dulu untuk menghapus pencocokan.");
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "BankTransaction" WHERE id = ${s.bankTransactionId} FOR UPDATE`;
    await tx.invoiceSettlement.delete({ where: { id: s.id } });
    if (s.withheld > 0n) {
      const rest = (await tx.bankTransaction.findUniqueOrThrow({ where: { id: s.bankTransactionId }, select: { whtKind: true, whtAmount: true } }));
      const left = rest.whtAmount - s.withheld;
      await setWithholdingTx(tx, s.bankTransactionId, left > 0n && rest.whtKind ? { kind: rest.whtKind, amount: left } : null);
    }
  });
}

export type SettleCandidate = {
  bankTransactionId: string;
  date: Date;
  description: string;
  amount: bigint;
  /** Not settled yet (absolute). */
  free: bigint;
  /** Its unsettled amount equals the invoice's open amount. */
  exact: boolean;
  /** Its description names the contact or the invoice number. */
  named: boolean;
  /** Already on the invoice's receivable/payable account (else settling reclassifies it). */
  onAccount: boolean;
};

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
/** Company-form words don't identify anyone ("PT", "CV" …); a name matches on its distinctive words. */
const FORMS = new Set(["PT", "CV", "TBK", "UD", "PD", "KOPERASI", "YAYASAN", "BAPAK", "IBU", "BPK"]);

/**
 * Bank lines that could settle an invoice: same entity, the invoice's direction, not fully settled, in an open month. Suggestions are
 * the ones whose unsettled amount equals the invoice's open amount, those naming the contact or the number first. Never applied.
 */
export async function settleCandidates(db: Db, clientId: string, invoiceId: string): Promise<SettleCandidate[]> {
  const invoice = await db.invoice.findFirst({ where: { id: invoiceId, clientId }, include: { contact: true, arApAccount: true, settlements: { select: { amount: true, withheld: true } } } });
  if (!invoice) return [];
  const open = invoice.total - invoice.settlements.reduce((s, x) => s + x.amount, 0n);
  // A customer that withholds pays the invoice less the tax: that amount is as exact as the open amount.
  const expectedTax = invoice.whtAmount - invoice.settlements.reduce((s, x) => s + x.withheld, 0n);
  const net = expectedTax > 0n ? open - expectedTax : open;
  if (open <= 0n) return [];
  const locked = await lockedMonths(db, clientId);
  const lines = await db.bankTransaction.findMany({
    where: { entityId: invoice.entityId, direction: invoice.direction === "SALES" ? "IN" : "OUT", date: { gte: invoice.opening ? new Date(0) : invoice.issueDate } },
    include: { settlements: { select: { amount: true, withheld: true } } },
    orderBy: [{ date: "asc" }, { rowNumber: "asc" }],
  });
  const words = norm(invoice.contact.name).split(" ").filter((w) => w.length >= 3 && !FORMS.has(w));
  const number = norm(invoice.number);
  return lines
    .filter((t) => !locked.has(monthKey(t.date)))
    .map((t) => {
      const free = abs(t.amount) - cashUsed(t.settlements);
      const text = ` ${norm(t.description)} `;
      const named = (words.length > 0 && words.every((w) => text.includes(` ${w} `))) || (number.length >= 3 && text.includes(` ${number} `));
      return { bankTransactionId: t.id, date: t.date, description: t.description, amount: t.amount, free, exact: free === open || free === net, named, onAccount: t.status !== "NEEDS_REVIEW" && t.accountCode === invoice.arApAccount.code };
    })
    .filter((c) => c.free > 0n)
    .sort((a, b) => Number(b.exact && b.named) - Number(a.exact && a.named) || Number(b.exact) - Number(a.exact) || Number(b.named) - Number(a.named) || Number(b.onAccount) - Number(a.onAccount) || +a.date - +b.date);
}
