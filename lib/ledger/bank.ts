import type { Tx } from "@/lib/db";
import type { TaxTag } from "@/lib/generated/prisma/enums";
import { ACCOUNT_CODES } from "@/lib/coa/template";
import { splitPpn } from "@/lib/money";
import { postJournal, type PostLine } from "@/lib/ledger/post";

/**
 * Posting for bank transactions. The bank side is posted once and never changes.
 * The classification side (everything except the bank GL account) can be moved later
 * by a RECLASS entry that posts only the difference — so drill-down from any account
 * still lands on the same bank row (entries keep bankTransactionId).
 */
type Target = { accountCode: string; taxTag?: TaxTag | null };

/** Desired non-bank side as signed nets per account code (debit positive). */
export function classificationNets(amount: bigint, target: Target): Map<string, bigint> {
  const nets = new Map<string, bigint>();
  const add = (code: string, v: bigint) => nets.set(code, (nets.get(code) ?? 0n) + v);
  // Money in → bank debit, so classification side is credit (negative); money out → debit.
  const side = -amount;
  if (amount > 0n && target.taxTag === "PPN_KELUARAN") {
    const { dpp, ppn } = splitPpn(side);
    add(target.accountCode, dpp);
    add(ACCOUNT_CODES.PPN_KELUARAN, ppn);
  } else if (amount < 0n && target.taxTag === "PPN_MASUKAN") {
    const { dpp, ppn } = splitPpn(side);
    add(target.accountCode, dpp);
    add(ACCOUNT_CODES.PPN_MASUKAN, ppn);
  } else {
    add(target.accountCode, side);
  }
  return nets;
}

async function accountIdMap(tx: Tx, clientId: string) {
  const accounts = await tx.account.findMany({ where: { clientId }, select: { id: true, code: true } });
  return new Map(accounts.map((a) => [a.code, a.id]));
}

export async function postBankTransaction(
  tx: Tx,
  bankTxId: string,
  target: Target,
  opts: { codeToId?: Map<string, string> } = {},
) {
  const bankTx = await tx.bankTransaction.findUniqueOrThrow({
    where: { id: bankTxId },
    include: { bankAccount: { include: { entity: true } } },
  });
  const clientId = bankTx.bankAccount.entity.clientId;
  const codeToId = opts.codeToId ?? (await accountIdMap(tx, clientId));
  const bankGlId = bankTx.bankAccount.accountId;
  const idOf = (code: string) => {
    const id = codeToId.get(code);
    if (!id) throw new Error(`Akun ${code} tidak ada di bagan akun`);
    return id;
  };

  const desired = classificationNets(bankTx.amount, target);
  const existing = await tx.journalLine.findMany({
    where: { entry: { bankTransactionId: bankTx.id }, accountId: { not: bankGlId } },
    select: { accountId: true, debit: true, credit: true },
  });

  const toLines = (nets: Map<string, bigint>): PostLine[] =>
    [...nets.entries()].map(([accountId, v]) => (v > 0n ? { accountId, debit: v } : { accountId, credit: -v }));

  if (existing.length === 0) {
    const nets = new Map<string, bigint>();
    for (const [code, v] of desired) nets.set(idOf(code), v);
    nets.set(bankGlId, (nets.get(bankGlId) ?? 0n) + bankTx.amount);
    return postJournal(tx, {
      entityId: bankTx.entityId,
      date: bankTx.date,
      kind: "BANK",
      memo: bankTx.description,
      bankTransactionId: bankTx.id,
      lines: toLines(nets),
    });
  }

  const diff = new Map<string, bigint>();
  for (const l of existing) diff.set(l.accountId, (diff.get(l.accountId) ?? 0n) - (l.debit - l.credit));
  for (const [code, v] of desired) {
    const id = idOf(code);
    diff.set(id, (diff.get(id) ?? 0n) + v);
  }
  for (const [k, v] of diff) if (v === 0n) diff.delete(k);
  if (diff.size === 0) return null;
  return postJournal(tx, {
    entityId: bankTx.entityId,
    date: bankTx.date,
    kind: "RECLASS",
    memo: `Reklasifikasi: ${bankTx.description}`,
    bankTransactionId: bankTx.id,
    lines: toLines(diff),
  });
}
