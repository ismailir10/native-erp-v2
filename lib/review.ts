import type { Db, Tx } from "@/lib/db";
import type { TaxTag } from "@/lib/generated/prisma/enums";
import { postBankTransaction } from "@/lib/ledger/bank";

type ReviewArgs = { bankTxId: string; accountCode: string; taxTag: TaxTag | null; createRule?: boolean; actorId?: string | null };

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
    include: { bankAccount: { include: { entity: true } } },
  });
  const clientId = t.bankAccount.entity.clientId;
  await postBankTransaction(tx, t.id, { accountCode: args.accountCode, taxTag: args.taxTag }, { actorId: args.actorId });
  const changed = args.accountCode !== t.suggestedCode || args.taxTag !== t.taxTag;
  await tx.bankTransaction.update({
    where: { id: t.id },
    data: {
      status: "REVIEWED",
      accountCode: args.accountCode,
      taxTag: args.taxTag,
      method: changed ? "MANUAL" : t.method,
      reason: changed ? "Diubah oleh reviewer" : t.reason,
    },
  });
  await tx.memory.upsert({
    where: { clientId_merchantKey_direction: { clientId, merchantKey: t.merchantKey, direction: t.direction } },
    create: { clientId, merchantKey: t.merchantKey, direction: t.direction, accountCode: args.accountCode, taxTag: args.taxTag },
    update: { accountCode: args.accountCode, taxTag: args.taxTag, hits: { increment: 1 } },
  });
  if (args.createRule) {
    await tx.rule.create({
      data: { firmId: t.firmId, clientId, pattern: t.merchantKey, direction: t.direction, accountCode: args.accountCode, taxTag: args.taxTag, priority: 60, source: "USER" },
    });
  }
  return t.id;
}

/** Accept every open line with the same merchant key + direction using its suggestion. */
export async function acceptSimilar(db: Db, bankTxId: string, scope?: { entityIds: string[]; through: Date }, actorId?: string | null) {
  const t = await db.bankTransaction.findUniqueOrThrow({ where: { id: bankTxId } });
  const peers = await db.bankTransaction.findMany({
    where: { ...(scope ? { entityId: { in: scope.entityIds }, date: { lte: scope.through } } : {}), bankAccount: { entity: { clientId: (await db.entity.findUniqueOrThrow({ where: { id: t.entityId } })).clientId } }, merchantKey: t.merchantKey, direction: t.direction, status: "NEEDS_REVIEW" },
  });
  for (const p of peers) {
    await reviewTransaction(db, { bankTxId: p.id, accountCode: t.suggestedCode ?? "6190", taxTag: t.taxTag, actorId });
  }
  return peers.length;
}
