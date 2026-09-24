import type { Db } from "@/lib/db";
import { AiAnswerError, aiConfig } from "@/lib/ai/provider";

export const INTAKE_TOKEN_LIMIT = 20_000;
export const QUESTION_TOKEN_LIMIT = 12_000;
export class AiBudgetError extends Error {}
type Prompt = { system: string; user: string };
type Usage = { promptTokens: number; completionTokens: number; model: string };
type BudgetArgs = {
  firmId: string; scope: string; prompt: Prompt; maxCompletionTokens: number;
  scopeTokenLimit?: number; monthlyTokenBudget?: number;
};

/** One UTF-8 byte per token plus message framing is a conservative bound, not a billing estimate. */
export function reservationTokens(prompt: Prompt, maxCompletionTokens: number) {
  if (!Number.isSafeInteger(maxCompletionTokens) || maxCompletionTokens < 0) throw new AiBudgetError("Batas token AI tidak valid");
  return Buffer.byteLength(prompt.system, "utf8") + Buffer.byteLength(prompt.user, "utf8") + 256 + maxCompletionTokens;
}

/** Reserve under a firm advisory lock; the paid network call must happen after this transaction ends. */
export async function reserveAiBudget(db: Db, args: BudgetArgs) {
  const tokens = reservationTokens(args.prompt, args.maxCompletionTokens);
  const monthlyLimit = args.monthlyTokenBudget ?? aiConfig().monthlyTokenBudget;
  if (!Number.isSafeInteger(monthlyLimit) || monthlyLimit < 0 || (args.scopeTokenLimit !== undefined && (!Number.isSafeInteger(args.scopeTokenLimit) || args.scopeTokenLimit < 0))) throw new AiBudgetError("Batas token AI tidak valid");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-budget:${args.firmId}`}))::text`;
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const used = await tx.aiUsage.aggregate({ where: { firmId: args.firmId, at: { gte: monthStart } }, _sum: { promptTokens: true, completionTokens: true } });
    // Pending reservations never expire automatically: an interrupted request may still be billed.
    const pending = await tx.aiReservation.aggregate({ where: { firmId: args.firmId, settled: false }, _sum: { tokens: true } });
    const spent = (used._sum.promptTokens ?? 0) + (used._sum.completionTokens ?? 0) + (pending._sum.tokens ?? 0);
    if (spent + tokens > monthlyLimit) throw new AiBudgetError("Kuota token AI bulan ini tidak cukup; lanjutkan manual atau ubah batas di Pengaturan.");
    if (args.scopeTokenLimit !== undefined) {
      const scope = await tx.aiReservation.aggregate({ where: { firmId: args.firmId, scope: args.scope }, _sum: { tokens: true } });
      if ((scope._sum.tokens ?? 0) + tokens > args.scopeTokenLimit) throw new AiBudgetError("Batas token untuk proses ini tercapai; hasil tersimpan, lanjutkan manual.");
    }
    return tx.aiReservation.create({ data: { firmId: args.firmId, scope: args.scope, tokens } });
  });
}

/** Atomic settlement and usage logging prevent a gap allowing another caller to overspend. */
export async function settleAiBudget(db: Db, reservation: { id: string; firmId: string; tokens: number }, args: {
  usage?: Usage; model: string; ok: boolean; keysRequested?: number; cacheHits?: number; note?: string;
}) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-budget:${reservation.firmId}`}))::text`;
    const current = await tx.aiReservation.findFirstOrThrow({ where: { id: reservation.id, firmId: reservation.firmId } });
    if (current.settled) return;
    const validUsage = args.usage && Number.isSafeInteger(args.usage.promptTokens) && args.usage.promptTokens >= 0 && Number.isSafeInteger(args.usage.completionTokens) && args.usage.completionTokens >= 0 && args.usage.promptTokens + args.usage.completionTokens > 0;
    // Missing/unknown billing (timeout, 503, malformed usage) retains the full reservation as usage.
    const promptTokens = validUsage ? args.usage!.promptTokens : current.tokens;
    const completionTokens = validUsage ? args.usage!.completionTokens : 0;
    await tx.aiUsage.create({ data: { firmId: current.firmId, model: args.usage?.model ?? args.model, keysRequested: args.keysRequested ?? 1, cacheHits: args.cacheHits ?? 0, calls: 1, promptTokens, completionTokens, ok: args.ok, note: args.note } });
    await tx.aiReservation.update({ where: { id: current.id }, data: { settled: true, tokens: promptTokens + completionTokens } });
  });
}

export async function runBudgetedAi<T extends Usage>(db: Db, args: BudgetArgs & {
  model: string; keysRequested?: number; cacheHits?: number; note?: string;
}, call: () => Promise<T>): Promise<T> {
  const reservation = await reserveAiBudget(db, args);
  let result: T;
  try {
    result = await call();
  } catch (error) {
    await settleAiBudget(db, reservation, { ...args, usage: error instanceof AiAnswerError ? error : undefined, ok: false, note: `AI gagal: ${error instanceof Error ? error.message.slice(0, 120) : "Permintaan gagal"}` });
    throw error;
  }
  await settleAiBudget(db, reservation, { ...args, usage: result, ok: true });
  return result;
}
