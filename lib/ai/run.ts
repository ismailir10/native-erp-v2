import { randomUUID } from "node:crypto";
import type { Db } from "@/lib/db";
import type { AiRun } from "@/lib/generated/prisma/client";
import { AI_TIMEOUT_MS, aiConfig, type AiProvider } from "@/lib/ai/provider";
import { lineKey, simpleGuessRows, suggestForRows } from "@/lib/ai/retry";

/**
 * Background AI suggestions for a client (cycle 2026-10-10-import-ai-background): one run per client covers every line still on a
 * simple guess, worked in time-boxed slices after the response. It only replaces suggestions of lines still in review — nothing is
 * posted (rules 17–19). Calls are capped per run (AI_MAX_CALLS_PER_RUN across all slices) and by the monthly budget.
 */

/** A slice ends well inside the platform's 300 s limit. */
export const AI_RUN_BUDGET_MS = 240_000;
/** A run that finished this recently is still shown (progress item on the import result and Review). */
const RECENT_MS = 24 * 60 * 60 * 1000;

const NO_PROVIDER_NOTE = "AI belum diatur";

/** Lines the run still has to settle: on a simple guess, minus keys this run already asked and left unanswered. */
async function pendingRows(db: Db, clientId: string, skippedKeys: string[]) {
  const skip = new Set(skippedKeys);
  return (await simpleGuessRows(db, { clientId })).filter((r) => !skip.has(lineKey(r)));
}

/**
 * Start (or join) the client's run. A RUNNING run is returned with the new lines counted in; otherwise a run is created for the
 * lines on a simple guess, or null when there are none. Concurrent starts end up on one run (partial unique index).
 */
export async function startAiRun(db: Db, args: { firmId: string; clientId: string }): Promise<AiRun | null> {
  await db.client.findFirstOrThrow({ where: { id: args.clientId, firmId: args.firmId }, select: { id: true } });
  const join = async () => {
    const running = await db.aiRun.findFirst({ where: { clientId: args.clientId, status: "RUNNING" } });
    if (!running) return null;
    const pending = (await pendingRows(db, args.clientId, running.skippedKeys)).length;
    // In SQL: a slice working right now may be adding to askedLines.
    await db.$executeRaw`UPDATE "AiRun" SET "totalLines" = "askedLines" + ${pending}::int WHERE "id" = ${running.id} AND "status" = 'RUNNING'`;
    return db.aiRun.findUniqueOrThrow({ where: { id: running.id } });
  };
  const joined = await join();
  if (joined) return joined;
  const pending = (await pendingRows(db, args.clientId, [])).length;
  if (!pending) return null;
  try {
    return await db.aiRun.create({ data: { firmId: args.firmId, clientId: args.clientId, totalLines: pending } });
  } catch (e) {
    // Another start won the race ("AiRun_one_running_per_client"): join its run.
    const other = await join();
    if (other) return other;
    throw e;
  }
}

export type AiSliceResult = { status: AiRun["status"]; done: boolean; claimed: boolean; progressed: boolean };

/**
 * One slice of a run: claim the lease, ask about what is pending until `deadline` (epoch ms; no call starts after it), write the
 * suggestions to lines still in review, record progress, release the lease. Returns without work when the deadline has passed or
 * another worker holds the lease. The run is DONE when nothing is left, the AI stopped it (budget, call cap, refused key/model,
 * two timeouts), or no provider is set.
 */
export async function runAiSlice(db: Db, runId: string, opts: { provider: AiProvider | null; deadline: number }): Promise<AiSliceResult> {
  const idle = async (): Promise<AiSliceResult> => {
    const run = await db.aiRun.findUniqueOrThrow({ where: { id: runId }, select: { status: true } });
    return { status: run.status, done: run.status === "DONE", claimed: false, progressed: false };
  };
  if (Date.now() >= opts.deadline) return idle();
  const token = randomUUID();
  // A call that starts just before the deadline may take up to AI_TIMEOUT_MS: the lease outlives it.
  const claim = await db.aiRun.updateMany({
    where: { id: runId, status: "RUNNING", OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] },
    data: { leaseToken: token, leaseUntil: new Date(opts.deadline + AI_TIMEOUT_MS + 30_000) },
  });
  if (!claim.count) return idle();
  const release = () => db.aiRun.updateMany({ where: { id: runId, leaseToken: token }, data: { leaseToken: null, leaseUntil: null } });
  try {
    const run = await db.aiRun.findUniqueOrThrow({ where: { id: runId } });
    const finished = { status: "DONE" as const, finishedAt: new Date() };
    if (!opts.provider) {
      await db.aiRun.update({ where: { id: runId }, data: { ...finished, note: NO_PROVIDER_NOTE, heartbeatAt: new Date() } });
      return { status: "DONE", done: true, claimed: true, progressed: false };
    }
    const rows = await pendingRows(db, run.clientId, run.skippedKeys);
    const r = await suggestForRows(db, { clientId: run.clientId, rows, provider: opts.provider, deadline: opts.deadline, maxCalls: Math.max(0, aiConfig().maxCallsPerRun - run.calls) });
    const skippedKeys = [...run.skippedKeys, ...r.unansweredKeys];
    const settledLines = rows.filter((row) => r.settled.has(lineKey(row))).length;
    // Recounted, not taken from `remaining`: lines a concurrent import added during this slice keep the run going.
    const left = (await pendingRows(db, run.clientId, skippedKeys)).length;
    const done = r.stopped || left === 0;
    await db.aiRun.update({
      where: { id: runId },
      data: {
        calls: { increment: r.calls },
        askedLines: { increment: settledLines },
        suggestedLines: { increment: r.updated },
        totalLines: run.askedLines + settledLines + left,
        ...(r.unansweredKeys.length ? { skippedKeys: { push: r.unansweredKeys } } : {}),
        note: r.notes.at(-1) ?? run.note, // the latest; a stop is always the last note of its slice
        heartbeatAt: new Date(),
        ...(done ? finished : {}),
      },
    });
    return { status: done ? "DONE" : "RUNNING", done, claimed: true, progressed: settledLines > 0 || r.calls > 0 };
  } finally {
    await release();
  }
}

/** Work a run until it is done or the time box ends — what the app runs after the response (next/server `after()`). */
export async function driveAiRun(db: Db, runId: string, opts: { provider: AiProvider | null; budgetMs?: number }): Promise<AiSliceResult> {
  const deadline = Date.now() + (opts.budgetMs ?? AI_RUN_BUDGET_MS);
  let r: AiSliceResult;
  do r = await runAiSlice(db, runId, { provider: opts.provider, deadline });
  while (r.claimed && r.progressed && !r.done && Date.now() < deadline);
  return r;
}

/** The client's run to show: the RUNNING one, else the latest finished in the last 24 h. */
export async function latestAiRun(db: Db, clientId: string): Promise<AiRun | null> {
  return (
    (await db.aiRun.findFirst({ where: { clientId, status: "RUNNING" } })) ??
    (await db.aiRun.findFirst({ where: { clientId, status: "DONE", finishedAt: { gte: new Date(Date.now() - RECENT_MS) } }, orderBy: { finishedAt: "desc" } }))
  );
}

/** RUNNING with no live worker (the slice ended or the function was cut off): the next page view resumes it. */
export const isStalled = (run: Pick<AiRun, "status" | "leaseUntil">, now = new Date()) => run.status === "RUNNING" && (!run.leaseUntil || run.leaseUntil < now);
