import { createHash } from "node:crypto";
import type { Db } from "@/lib/db";
import type { Direction } from "@/lib/generated/prisma/enums";
import { AI_BATCH_SIZE, CLASSIFICATION_PROMPT_VERSION, DEMO_AI_MODEL, aiConfig, buildPrompt, maxTokensFor, type AiItem, type AiProvider } from "@/lib/ai/provider";
import { AiBudgetError, runBudgetedAi } from "@/lib/ai/budget";
import type { Classification } from "@/lib/classify/types";

export type ClassificationCacheContext = { firmId: string; clientId: string; model: string; clientName: string; accounts: { code: string; name: string }[]; sample: string };
export function aiCacheKey(merchantKey: string, direction: Direction, coaVersion: number, scope: ClassificationCacheContext) {
  const prompt = buildPrompt([{ key: merchantKey, direction, sample: scope.sample }], [...scope.accounts].sort((a, b) => a.code.localeCompare(b.code)), scope.clientName);
  return createHash("sha256").update(JSON.stringify([scope.firmId, scope.clientId, coaVersion, scope.model, CLASSIFICATION_PROMPT_VERSION, prompt])).digest("hex");
}

type Pending = { key: string; direction: Direction; sample: string };

/**
 * Resolve leftovers via cache first, then (budget permitting) the provider in batches.
 * Returns suggestions keyed by `${merchantKey}|${direction}`. Never throws on AI failure —
 * failures just leave items for the heuristic fallback.
 */
export async function suggestWithAi(
  tx: Db,
  args: {
    firmId: string;
    clientId: string;
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

  const keyOf = (p: Pending, model = args.provider?.model ?? "disabled") => aiCacheKey(p.key, p.direction, args.coaVersion, { ...args, model, sample: p.sample });
  const keys = [...unique.values()].flatMap(p => [keyOf(p), keyOf(p, DEMO_AI_MODEL)]);
  const cached = await tx.aiSuggestion.findMany({ where: { cacheKey: { in: keys } } });
  const byCache = new Map(cached.map((c) => [c.cacheKey, c]));
  const misses: Pending[] = [];
  for (const [k, p] of unique) {
    const primary = byCache.get(keyOf(p));
    const synthetic = byCache.get(keyOf(p, DEMO_AI_MODEL));
    const hit = primary ?? (synthetic?.model === DEMO_AI_MODEL ? synthetic : undefined);
    if (hit && args.accounts.some((a) => a.code === hit.accountCode)) suggestions.set(k, { method: "AI", accountCode: hit.accountCode, taxTag: hit.taxTag, confidence: hit.confidence, reason: `AI: ${hit.reason}` });
    else misses.push(p);
  }
  const cacheHits = suggestions.size;
  if (misses.length === 0 || !args.provider) {
    return { suggestions, usage: { calls: 0, cacheHits, note: !args.provider && misses.length ? "AI tidak aktif" : undefined } };
  }

  const cfg = aiConfig();

  let calls = 0;
  let note: string | undefined;
  for (let i = 0; i < misses.length && calls < cfg.maxCallsPerImport; i += AI_BATCH_SIZE) {
    const batch: AiItem[] = misses.slice(i, i + AI_BATCH_SIZE).map((p) => ({ key: p.key, direction: p.direction, sample: p.sample }));
    try {
      const res = await runBudgetedAi(tx, { firmId: args.firmId, scope: `classify:${args.clientId}`, prompt: buildPrompt(batch, args.accounts, args.clientName), maxCompletionTokens: maxTokensFor(batch.length), model: args.provider.model, keysRequested: batch.length, cacheHits }, () => {
        calls++;
        return args.provider!.classify(batch, args.accounts, args.clientName);
      });
      for (const a of res.answers) {
        const p = batch.find((b) => b.key === a.key);
        if (!p || !args.accounts.some((account) => account.code === a.accountCode)) continue;
        await tx.aiSuggestion.upsert({
          where: { cacheKey: keyOf(p) },
          create: { cacheKey: keyOf(p), merchantKey: a.key, direction: p.direction, accountCode: a.accountCode, confidence: a.confidence, taxTag: a.taxTag, reason: a.reason, model: res.model },
          update: {},
        });
        suggestions.set(`${a.key}|${p.direction}`, { method: "AI", accountCode: a.accountCode, taxTag: a.taxTag, confidence: a.confidence, reason: `AI: ${a.reason}` });
      }
    } catch (e) {
      note = e instanceof AiBudgetError ? e.message : `AI gagal: ${(e as Error).message.slice(0, 120)}`;
      break; // no retry loop — credit protection
    }
  }
  if (!note && misses.length > calls * AI_BATCH_SIZE) note = "Batas panggilan AI per impor tercapai";
  return { suggestions, usage: { calls, cacheHits, note } };
}
