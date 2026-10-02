import { isSimpleGuess, simpleGuess } from "@/lib/classify/fallback";
import type { Db, Tx } from "@/lib/db";
import type { TaxTag } from "@/lib/generated/prisma/enums";
import { postBankTransaction } from "@/lib/ledger/bank";
import { LedgerError } from "@/lib/ledger/post";
import { isGenericKey } from "@/lib/import/normalize";
import { ACCOUNT_CODES } from "@/lib/coa/template";
import { defaultTaxMonth } from "@/lib/tax/masa";
import { checkWithholding, type Withholding } from "@/lib/tax/withholding";

type ReviewArgs = {
  bankTxId: string;
  accountCode: string;
  taxTag: TaxTag | null;
  createRule?: boolean;
  actorId?: string | null;
  /**
   * false: a provisional decision (the line goes back to Review) — Memory learns only from the final one. Unset: learns, except a simple
   * guess accepted unchanged (fallback.ts `isSimpleGuess`), which is no one's decision yet. true: learns anyway (the seed's ground truth).
   */
  learn?: boolean;
  /**
   * Tax withheld from this payment or receipt (rent, services, a customer's PPh 23): the part not in the bank amount, posted on the
   * classification side (accounting-rules 5h). undefined keeps what the line has; null removes it.
   */
  withholding?: Withholding | null;
};

/**
 * Reviewer decision on a bank line. Posts a RECLASS (difference only), marks REVIEWED,
 * and always feeds the learning loop (Memory) so the next import needs fewer AI calls.
 */
export async function reviewTransaction(db: Db, args: ReviewArgs) {
  return db.$transaction((tx) => reviewTransactionTx(tx, args));
}

/** The same decision inside a caller's transaction (a posted proposal records the RECLASS it produced atomically). */
export async function reviewTransactionTx(tx: Tx, args: ReviewArgs) {
  const t = await tx.bankTransaction.findUniqueOrThrow({
    where: { id: args.bankTxId },
    include: { bankAccount: { include: { entity: true } }, settlements: { select: { withheld: true, invoice: { select: { number: true, arApAccount: { select: { code: true } } } } } } },
  });
  const clientId = t.bankAccount.entity.clientId;
  const generic = isGenericKey(t.merchantKey);
  if (args.createRule && generic) {
    throw new LedgerError(`Keterangan "${t.merchantKey}" tidak menyebut pengirim atau penerima, jadi tidak bisa dijadikan aturan. Pilih akunnya per transaksi.`);
  }
  // A line that settles invoices stays on their receivable/payable account (rule 5c): moving it would leave them paid by money the
  // ledger no longer shows there.
  const away = t.settlements.filter((s) => s.invoice.arApAccount.code !== args.accountCode);
  if (away.length) {
    throw new LedgerError(`Mutasi ini melunasi ${away.map((s) => s.invoice.number).join(", ")} di akun ${away[0].invoice.arApAccount.code}. Hapus pencocokannya dulu di Piutang & Utang sebelum mengubah akunnya.`);
  }
  // Withholding that comes from settlements is changed by (un)settling, not by hand: the invoice's amounts would no longer add up.
  const settledWht = t.settlements.reduce((sum, x) => sum + x.withheld, 0n);
  if (settledWht > 0n && args.withholding !== undefined && ((args.withholding?.amount ?? 0n) !== t.whtAmount || (args.withholding?.kind ?? null) !== t.whtKind)) {
    throw new LedgerError("Pemotongan pajak pada mutasi ini berasal dari pencocokan faktur. Ubah lewat pencocokan (hapus, lalu cocokkan lagi).");
  }
  // The withholding stays with the line through a change of account (the tax was withheld whichever account it files to), except in Review.
  const held = t.whtKind && t.whtAmount > 0n ? { kind: t.whtKind, amount: t.whtAmount } : null;
  const withholding = args.withholding === undefined ? (args.accountCode === ACCOUNT_CODES.SUSPENSE ? null : held) : args.withholding && checkWithholding(args.withholding, t.direction);
  await postBankTransaction(tx, t.id, { accountCode: args.accountCode, taxTag: args.taxTag, withholding }, { actorId: args.actorId });
  const changed = args.accountCode !== t.suggestedCode || args.taxTag !== t.taxTag;
  // A paired half moved off the transfer accounts is no longer half of a transfer (UC-B2): the link goes, and this line is never paired
  // again; its old partner may still find its real other half.
  const leavesPair = t.matchedTxId !== null && args.accountCode !== ACCOUNT_CODES.CLEARING && args.accountCode !== ACCOUNT_CODES.INTERCOMPANY;
  if (leavesPair) await tx.bankTransaction.updateMany({ where: { id: t.matchedTxId!, matchedTxId: t.id }, data: { matchedTxId: null } });
  await tx.bankTransaction.update({
    where: { id: t.id },
    data: {
      status: "REVIEWED",
      accountCode: args.accountCode,
      taxTag: args.taxTag,
      // The masa pajak of a PPh 25 instalment: the month before payment unless the accountant set one; none once it isn't PPh 25.
      taxMonth: args.taxTag === "PPH_25" ? (t.taxMonth ?? defaultTaxMonth(t.date)) : null,
      whtKind: withholding?.kind ?? null,
      whtAmount: withholding?.amount ?? 0n,
      method: changed ? "MANUAL" : t.method,
      reason: changed ? "Diubah oleh reviewer" : t.reason,
      ...(leavesPair ? { matchedTxId: null, pairRefused: true } : {}),
    },
  });
  // A key without a counterparty covers unrelated payments: never learned (normalize.ts, isGenericKey).
  const learn = args.learn ?? !(isSimpleGuess(t) && !changed && !args.createRule);
  if (learn && !generic) await tx.memory.upsert({
    where: { clientId_merchantKey_direction: { clientId, merchantKey: t.merchantKey, direction: t.direction } },
    create: { clientId, merchantKey: t.merchantKey, direction: t.direction, accountCode: args.accountCode, taxTag: args.taxTag },
    update: { accountCode: args.accountCode, taxTag: args.taxTag, hits: { increment: 1 } },
  });
  if (args.createRule) {
    await tx.rule.create({
      data: { firmId: t.firmId, clientId, pattern: t.merchantKey, direction: t.direction, accountCode: args.accountCode, taxTag: args.taxTag, priority: 60, source: "USER" },
    });
  }
  return { id: t.id, learned: learn && !generic };
}

/**
 * Sets the tax withheld on a settled bank line (its classification stays): posts the RECLASS of the difference. Used by (un)settling an
 * invoice, which owns the amount; null removes it.
 */
export async function setWithholdingTx(tx: Tx, bankTxId: string, withholding: Withholding | null, actorId?: string | null) {
  const t = await tx.bankTransaction.findUniqueOrThrow({ where: { id: bankTxId } });
  if (t.status === "NEEDS_REVIEW" || !t.accountCode) throw new LedgerError("Klasifikasikan mutasi ini dulu sebelum mencatat pemotongan pajak.");
  if (withholding) checkWithholding(withholding, t.direction);
  await postBankTransaction(tx, t.id, { accountCode: t.accountCode, taxTag: t.taxTag, withholding }, { actorId });
  await tx.bankTransaction.update({ where: { id: t.id }, data: { whtKind: withholding?.kind ?? null, whtAmount: withholding?.amount ?? 0n } });
}

/**
 * Accept every open line with the same merchant key + direction: with the source line's suggestion, or with the account/tax
 * the reviewer chose on it (`choice`). A generic key groups nothing. Returns the ids decided.
 */
export async function acceptSimilar(
  db: Db,
  bankTxId: string,
  scope?: { entityIds: string[]; through: Date },
  actorId?: string | null,
  choice?: { accountCode: string; taxTag: TaxTag | null },
): Promise<string[]> {
  const t = await db.bankTransaction.findUniqueOrThrow({ where: { id: bankTxId } });
  const entity = await db.entity.findUniqueOrThrow({ where: { id: t.entityId } });
  const peers = await db.bankTransaction.findMany({
    where: {
      ...(scope ? { entityId: { in: scope.entityIds }, date: { lte: scope.through } } : {}),
      bankAccount: { entity: { clientId: entity.clientId } },
      ...(isGenericKey(t.merchantKey) ? { id: t.id } : { merchantKey: t.merchantKey, direction: t.direction }),
      status: "NEEDS_REVIEW",
    },
  });
  const accountCode = choice?.accountCode ?? t.suggestedCode ?? simpleGuess(t.direction, entity.kind).accountCode;
  const taxTag = choice ? choice.taxTag : t.taxTag;
  for (const p of peers) {
    await reviewTransaction(db, { bankTxId: p.id, accountCode, taxTag, actorId });
  }
  return peers.map((p) => p.id);
}

/**
 * *Lepas pasangan* (use-case feedback UC-B2): the reviewer says two lines are not one transfer. Both halves go back to Review on 1999
 * through the bank writer (a RECLASS of the difference; the bank side never moves), lose their link, and are marked so no later import
 * pairs them again. Their transfer suggestion stays for the reviewer to accept or change. A locked month refuses (postJournal).
 */
export async function unpairTransfer(db: Db, args: { clientId: string; bankTxId: string; actorId?: string | null }) {
  return db.$transaction(async (tx) => {
    const t = await tx.bankTransaction.findFirst({ where: { id: args.bankTxId, bankAccount: { entity: { clientId: args.clientId } } } });
    if (!t) throw new LedgerError("Mutasi tidak ditemukan.");
    if (!t.matchedTxId) throw new LedgerError("Mutasi ini tidak berpasangan dengan transfer lain.");
    const halves = await tx.bankTransaction.findMany({ where: { id: { in: [t.id, t.matchedTxId] }, bankAccount: { entity: { clientId: args.clientId } } }, include: { settlements: { select: { invoice: { select: { number: true } } } } } });
    // A half that settles invoices stays where they are paid (rule 5c): unsettle first.
    const settled = halves.flatMap((h) => h.settlements.map((x) => x.invoice.number));
    if (settled.length) throw new LedgerError(`Mutasi ini melunasi ${settled.join(", ")}. Hapus pencocokannya dulu di Piutang & Utang sebelum melepas pasangannya.`);
    for (const h of halves) {
      await postBankTransaction(tx, h.id, { accountCode: ACCOUNT_CODES.SUSPENSE }, { actorId: args.actorId });
      await tx.bankTransaction.update({
        where: { id: h.id },
        data: {
          status: "NEEDS_REVIEW",
          accountCode: ACCOUNT_CODES.SUSPENSE,
          suggestedCode: h.accountCode,
          taxTag: null,
          whtKind: null,
          whtAmount: 0n,
          matchedTxId: null,
          pairRefused: true,
          reason: "Pasangan transfer dilepas oleh reviewer: pilih akunnya",
        },
      });
    }
    return halves.map((h) => h.id);
  });
}
