import type { Db } from "@/lib/db";
import type { ClassifyMethod, Direction } from "@/lib/generated/prisma/enums";
import { ACCOUNT_CODES } from "@/lib/coa/template";
import { parseStatement } from "@/lib/import/parsers";
import { checkContinuity, merchantKey, rowHash } from "@/lib/import/normalize";
import { ParseError } from "@/lib/import/types";
import { matchRule, sortRules } from "@/lib/classify/rules";
import { matchTransfers, type TransferCandidate } from "@/lib/classify/transfer";
import { AUTO_POST_CONFIDENCE, type Classification } from "@/lib/classify/types";
import { suggestWithAi } from "@/lib/ai/classify";
import type { AiProvider } from "@/lib/ai/provider";
import { postBankTransaction } from "@/lib/ledger/bank";
import { formatPeriod } from "@/lib/format";

export type ImportSummary = {
  importId: string;
  rows: number;
  duplicates: number;
  posted: number;
  needsReview: number;
  byMethod: Record<ClassifyMethod, number>;
  ai: { calls: number; cacheHits: number; note?: string };
  continuityOk: boolean;
  continuityNote: string | null;
};

const HEURISTIC: Record<Direction, Classification> = {
  IN: { method: "HEURISTIC", accountCode: "4100", taxTag: null, confidence: 0.3, reason: "Tebakan sederhana: uang masuk dianggap penjualan" },
  OUT: { method: "HEURISTIC", accountCode: "6190", taxTag: null, confidence: 0.3, reason: "Tebakan sederhana: uang keluar dianggap beban umum" },
};

export async function importStatement(
  db: Db,
  args: { bankAccountId: string; fileName: string; data: Buffer; provider: AiProvider | null },
): Promise<ImportSummary> {
  const bankAccount = await db.bankAccount.findUniqueOrThrow({
    where: { id: args.bankAccountId },
    include: { entity: { include: { client: { include: { entities: true } } } } },
  });
  const entity = bankAccount.entity;
  const client = entity.client;

  const st = await parseStatement(args.fileName, args.data);
  if (st.accountNumber && st.accountNumber !== bankAccount.number) {
    throw new ParseError(`Nomor rekening di file (${st.accountNumber}) berbeda dengan rekening terpilih (${bankAccount.number}).`);
  }
  const continuity = checkContinuity(st);

  const locked = await db.period.findMany({ where: { clientId: client.id, status: "LOCKED" } });
  const lockedHit = st.rows.find((r) => locked.some((p) => p.year === r.date.getUTCFullYear() && p.month === r.date.getUTCMonth() + 1));
  if (lockedHit) {
    throw new ParseError(`Periode ${formatPeriod(lockedHit.date.getUTCFullYear(), lockedHit.date.getUTCMonth() + 1)} sudah ditutup. Buka periode dulu atau pilih file lain.`);
  }

  // Dedupe against what's already imported for this bank account.
  const hashes = st.rows.map(rowHash);
  const existing = new Set(
    (await db.bankTransaction.findMany({ where: { bankAccountId: bankAccount.id, hash: { in: hashes } }, select: { hash: true } })).map((t) => t.hash),
  );
  const fresh = st.rows.map((r, i) => ({ r, hash: hashes[i] })).filter((x) => !existing.has(x.hash));

  const items = fresh.map(({ r, hash }, i) => ({
    id: `new-${i}`,
    hash,
    row: r,
    entityId: entity.id,
    bankAccountId: bankAccount.id,
    date: r.date,
    description: r.description,
    merchantKey: merchantKey(r.description),
    direction: (r.amount >= 0n ? "IN" : "OUT") as Direction,
    amount: r.amount,
  }));

  // ---- classification (reads only; AI runs outside the write transaction) ----
  const window = items.length
    ? { gte: new Date(items[0].date.getTime() - 3 * 86_400_000), lte: new Date(items[items.length - 1].date.getTime() + 3 * 86_400_000) }
    : undefined;
  const openCounterparts: TransferCandidate[] = window
    ? (
        await db.bankTransaction.findMany({
          where: { bankAccount: { entity: { clientId: client.id } }, matchedTxId: null, date: window, bankAccountId: { not: bankAccount.id } },
        })
      ).map((t) => ({ ...t, id: t.id }))
    : [];
  const ownNames = client.entities.map((e) => ({ entityId: e.id, names: [e.name.toUpperCase(), e.shortName.toUpperCase()] }));
  const transfers = matchTransfers([...items, ...openCounterparts], ownNames);

  const rules = sortRules(await db.rule.findMany({ where: { firmId: client.firmId, OR: [{ clientId: client.id }, { clientId: null }] } }));
  const memories = await db.memory.findMany({ where: { clientId: client.id } });
  const memoryMap = new Map(memories.map((m) => [`${m.merchantKey}|${m.direction}`, m]));

  const result = new Map<string, Classification>();
  const pendingAi: { key: string; direction: Direction; sample: string }[] = [];
  for (const it of items) {
    const c =
      transfers.get(it.id) ??
      matchRule(rules, it.description, it.direction) ??
      (() => {
        const m = memoryMap.get(`${it.merchantKey}|${it.direction}`);
        return m
          ? ({ method: "MEMORY", accountCode: m.accountCode, taxTag: m.taxTag, confidence: 0.95, reason: `Pernah dikonfirmasi ${m.hits}× untuk "${m.merchantKey}"` } as Classification)
          : null;
      })();
    if (c) result.set(it.id, c);
    else pendingAi.push({ key: it.merchantKey, direction: it.direction, sample: it.description });
  }

  const accounts = await db.account.findMany({ where: { clientId: client.id }, orderBy: { code: "asc" } });
  const postable = accounts.filter((a) => !a.isBank && !a.isSuspense && !a.isRetained).map((a) => ({ code: a.code, name: a.name }));
  const ai = await suggestWithAi(db, {
    firmId: client.firmId,
    clientName: `${client.name} (${client.industry ?? "umum"})`,
    coaVersion: client.coaVersion,
    accounts: postable,
    pending: pendingAi,
    provider: args.provider,
  });
  for (const it of items) {
    if (result.has(it.id)) continue;
    result.set(it.id, ai.suggestions.get(`${it.merchantKey}|${it.direction}`) ?? HEURISTIC[it.direction]);
  }

  // ---- write: import + transactions + journals, all-or-nothing ----
  const byMethod = { TRANSFER: 0, RULE: 0, MEMORY: 0, AI: 0, HEURISTIC: 0, MANUAL: 0 } as Record<ClassifyMethod, number>;
  let needsReview = 0;
  const codeToId = new Map(accounts.map((a) => [a.code, a.id]));

  const importId = await db.$transaction(
    async (tx) => {
      const imp = await tx.statementImport.create({
        data: {
          firmId: client.firmId,
          bankAccountId: bankAccount.id,
          fileName: args.fileName,
          format: st.format,
          periodStart: st.periodStart,
          periodEnd: st.periodEnd,
          openingBalance: st.openingBalance,
          closingBalance: st.closingBalance,
          rowCount: st.rows.length,
          duplicateCount: st.rows.length - fresh.length,
          continuityOk: continuity.ok,
          continuityNote: continuity.note,
        },
      });
      const idMap = new Map<string, string>();
      for (const it of items) {
        const c = result.get(it.id)!;
        const auto = c.method !== "AI" && c.method !== "HEURISTIC" && c.confidence >= AUTO_POST_CONFIDENCE;
        const created = await tx.bankTransaction.create({
          data: {
            firmId: client.firmId,
            importId: imp.id,
            bankAccountId: bankAccount.id,
            entityId: entity.id,
            date: it.date,
            description: it.description,
            merchantKey: it.merchantKey,
            direction: it.direction,
            amount: it.amount,
            balance: it.row.balance,
            rowNumber: it.row.rowNumber,
            rawRow: it.row.rawRow,
            hash: it.hash,
            status: auto ? "POSTED" : "NEEDS_REVIEW",
            method: c.method,
            confidence: c.confidence,
            reason: c.reason,
            accountCode: auto ? c.accountCode : ACCOUNT_CODES.SUSPENSE,
            suggestedCode: c.accountCode,
            taxTag: c.taxTag,
          },
        });
        idMap.set(it.id, created.id);
        byMethod[c.method]++;
        if (!auto) needsReview++;
        await postBankTransaction(tx, created.id, auto ? { accountCode: c.accountCode, taxTag: c.taxTag } : { accountCode: ACCOUNT_CODES.SUSPENSE }, { codeToId });
      }
      // Link transfer pairs (both new, or new ↔ previously imported open half).
      for (const [id, c] of transfers) {
        if (!c.matchedTxId) continue;
        const selfId = idMap.get(id) ?? id;
        const otherId = idMap.get(c.matchedTxId) ?? c.matchedTxId;
        if (id.startsWith("new-")) {
          await tx.bankTransaction.update({ where: { id: selfId }, data: { matchedTxId: otherId } });
        } else {
          // Previously imported half: link and move it onto the transfer account if it was elsewhere.
          const prev = await tx.bankTransaction.update({ where: { id: selfId }, data: { matchedTxId: otherId } });
          if (prev.accountCode !== c.accountCode) {
            await postBankTransaction(tx, prev.id, { accountCode: c.accountCode }, { codeToId });
            await tx.bankTransaction.update({
              where: { id: prev.id },
              data: { accountCode: c.accountCode, status: "POSTED", method: "TRANSFER", confidence: c.confidence, reason: c.reason, taxTag: null },
            });
          }
        }
      }
      return imp.id;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  return {
    importId,
    rows: st.rows.length,
    duplicates: st.rows.length - fresh.length,
    posted: items.length - needsReview,
    needsReview,
    byMethod,
    ai: ai.usage,
    continuityOk: continuity.ok,
    continuityNote: continuity.note,
  };
}
