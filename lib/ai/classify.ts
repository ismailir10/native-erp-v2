import { createHash } from "node:crypto";
import type { Tx } from "@/lib/db";
import type { Direction } from "@/lib/generated/prisma/enums";
import { AI_BATCH_SIZE, AiAnswerError, aiConfig, type AiItem, type AiProvider } from "@/lib/ai/provider";
import type { Classification } from "@/lib/classify/types";

export function aiCacheKey(merchantKey: string, direction: Direction, coaVersion: number) {
  return createHash("sha1").update(`${merchantKey}|${direction}|v${coaVersion}`).digest("hex").slice(0, 32);
}

type Pending = { key: string; direction: Direction; sample: string };

/**
 * Resolve leftovers via cache first, then (budget permitting) the provider in batches.
 * Returns suggestions keyed by `${merchantKey}|${direction}`. Never throws on AI failure —
 * failures just leave items for the heuristic fallback.
 */
export async function suggestWithAi(
  tx: Tx,
  args: {
    firmId: string;
    clientName: string;
    coaVersion: number;
    accounts: { code: string; name: string }[];
    pending: Pending[];
    provider: AiProvider | null;
  },
): Promise<{ suggestions: Map<string, Classification>; usage: { calls: number; cacheHits: number; note?: string } }> {
  const suggestions = new Map<string, Classification>();
  const unique = new Map<string, Pending>();
  for (const p of args.pending) unique.set(`${p.key}|${p.direction}`, p);

  const keyOf = (p: Pending) => aiCacheKey(p.key, p.direction, args.coaVersion);
  const cached = await tx.aiSuggestion.findMany({ where: { cacheKey: { in: [...unique.values()].map(keyOf) } } });
  const byCache = new Map(cached.map((c) => [c.cacheKey, c]));
  const misses: Pending[] = [];
  for (const [k, p] of unique) {
    const hit = byCache.get(keyOf(p));
    if (hit) suggestions.set(k, { method: "AI", accountCode: hit.accountCode, taxTag: hit.taxTag, confidence: hit.confidence, reason: `AI: ${hit.reason}` });
    else misses.push(p);
  }
  const cacheHits = suggestions.size;
  if (misses.length === 0 || !args.provider) {
    return { suggestions, usage: { calls: 0, cacheHits, note: !args.provider && misses.length ? "AI tidak aktif" : undefined } };
  }

  const cfg = aiConfig();
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const used = await tx.aiUsage.aggregate({ where: { firmId: args.firmId, at: { gte: monthStart } }, _sum: { promptTokens: true, completionTokens: true } });
  const usedTokens = (used._sum.promptTokens ?? 0) + (used._sum.completionTokens ?? 0);
  if (usedTokens >= cfg.monthlyTokenBudget) {
    return { suggestions, usage: { calls: 0, cacheHits, note: "Kuota token AI bulan ini habis" } };
  }

  let calls = 0;
  let note: string | undefined;
  for (let i = 0; i < misses.length && calls < cfg.maxCallsPerImport; i += AI_BATCH_SIZE) {
    const batch: AiItem[] = misses.slice(i, i + AI_BATCH_SIZE).map((p) => ({ key: p.key, direction: p.direction, sample: p.sample }));
    calls++;
    try {
      const res = await args.provider.classify(batch, args.accounts, args.clientName);
      await tx.aiUsage.create({
        data: { firmId: args.firmId, model: res.model, keysRequested: batch.length, cacheHits, calls: 1, promptTokens: res.promptTokens, completionTokens: res.completionTokens, ok: true },
      });
      for (const a of res.answers) {
        const p = batch.find((b) => b.key === a.key)!;
        await tx.aiSuggestion.upsert({
          where: { cacheKey: aiCacheKey(a.key, p.direction, args.coaVersion) },
          create: { cacheKey: aiCacheKey(a.key, p.direction, args.coaVersion), merchantKey: a.key, direction: p.direction, accountCode: a.accountCode, confidence: a.confidence, taxTag: a.taxTag, reason: a.reason, model: res.model },
          update: {},
        });
        suggestions.set(`${a.key}|${p.direction}`, { method: "AI", accountCode: a.accountCode, taxTag: a.taxTag, confidence: a.confidence, reason: `AI: ${a.reason}` });
      }
    } catch (e) {
      note = `AI gagal: ${(e as Error).message.slice(0, 120)}`;
      const billed = e instanceof AiAnswerError ? e : null; // truncated/unreadable answers were still billed
      await tx.aiUsage.create({
        data: { firmId: args.firmId, model: billed?.model ?? args.provider.model, keysRequested: batch.length, cacheHits, calls: 1, promptTokens: billed?.promptTokens ?? 0, completionTokens: billed?.completionTokens ?? 0, ok: false, note },
      });
      break; // no retry loop — credit protection
    }
  }
  if (!note && misses.length > calls * AI_BATCH_SIZE) note = "Batas panggilan AI per impor tercapai";
  return { suggestions, usage: { calls, cacheHits, note } };
}
