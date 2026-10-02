import { isClassifiable } from "@/lib/coa/template";
import type { Db } from "@/lib/db";
import type { AiProvider } from "@/lib/ai/provider";
import { suggestWithAi } from "@/lib/ai/classify";
import { isSimpleGuess } from "@/lib/classify/fallback";

/**
 * Lines still in review that only got the simple guess (the AI call failed, was capped or off at import). Financing text and tax payments are
 * left out: their balance-sheet suggestion comes without an AI call (rule 13).
 */
export async function simpleGuessRows(db: Db, args: { clientId: string; entityIds: string[]; through: Date }) {
  const rows = await db.bankTransaction.findMany({
    where: { entityId: { in: args.entityIds }, bankAccount: { entity: { clientId: args.clientId } }, status: "NEEDS_REVIEW", method: "HEURISTIC", date: { lte: args.through } },
    orderBy: [{ date: "asc" }, { rowNumber: "asc" }],
  });
  return rows.filter(isSimpleGuess);
}

/**
 * *Minta saran AI* on Review: the same path as an import (cache, batches ≤ 40 unique keys, AI_MAX_CALLS_PER_IMPORT, monthly budget,
 * chart whitelist — rules 17–19), outside any transaction. It only replaces the suggestion of lines still in review; they stay on
 * 1999 until the accountant accepts (rule 14). Nothing is posted.
 */
export async function suggestAgainWithAi(db: Db, args: { clientId: string; entityIds: string[]; through: Date; provider: AiProvider | null }) {
  const rows = await simpleGuessRows(db, args);
  if (!rows.length) return { rows: 0, updated: 0, calls: 0, cacheHits: 0, note: undefined as string | undefined };
  const client = await db.client.findUniqueOrThrow({ where: { id: args.clientId } });
  const accounts = (await db.account.findMany({ where: { clientId: client.id }, orderBy: { code: "asc" } })).filter(isClassifiable);
  const ai = await suggestWithAi(db, {
    firmId: client.firmId,
    clientId: client.id,
    clientName: `${client.name} (${client.industry ?? "umum"})`,
    coaVersion: client.coaVersion,
    accounts: accounts.map((a) => ({ code: a.code, name: a.name })),
    pending: rows.map((r) => ({ key: r.merchantKey, direction: r.direction, sample: r.description })),
    provider: args.provider,
  });
  let updated = 0;
  for (const r of rows) {
    const s = ai.suggestions.get(`${r.merchantKey}|${r.direction}`);
    if (!s) continue;
    // Only while it is still waiting: a line accepted meanwhile keeps the accountant's decision.
    const res = await db.bankTransaction.updateMany({
      where: { id: r.id, status: "NEEDS_REVIEW", method: "HEURISTIC" },
      data: { method: "AI", suggestedCode: s.accountCode, taxTag: s.taxTag, confidence: s.confidence, reason: s.reason },
    });
    updated += res.count;
  }
  return { rows: rows.length, updated, calls: ai.usage.calls, cacheHits: ai.usage.cacheHits, note: ai.usage.note };
}
