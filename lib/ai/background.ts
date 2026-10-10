import { after } from "next/server";
import type { Db } from "@/lib/db";
import type { AiProvider } from "@/lib/ai/provider";
import { aiRunView, isStalled, latestAiRun, runInBackground, startAiRun, type AiRunView } from "@/lib/ai/run";
import { resolveProvider } from "@/lib/settings/ai";

/**
 * The app's side of the background run (lib/ai/run.ts): work scheduled with next/server `after()`, so no request waits on an AI call.
 * Callers check access first; only a member who may write a client's books starts or resumes paid calls for it.
 */

/** Start (or join) the client's run and schedule its work after the response. */
export async function scheduleAiRun(db: Db, client: { id: string; firmId: string }, provider: AiProvider): Promise<AiRunView | null> {
  const run = await startAiRun(db, { firmId: client.firmId, clientId: client.id });
  if (run) after(() => runInBackground(db, { firmId: client.firmId, clientId: client.id, provider }));
  return aiRunView(run);
}

/** The client's run to show; a stalled one is resumed after the response when the viewer may write (read-only viewers only see it). */
export async function aiRunForView(db: Db, client: { id: string; firmId: string }, opts: { canWrite: boolean }): Promise<AiRunView | null> {
  const run = await latestAiRun(db, client.id);
  if (run && opts.canWrite && isStalled(run)) {
    const provider = await resolveProvider(db);
    after(() => runInBackground(db, { firmId: client.firmId, clientId: client.id, provider }));
  }
  return aiRunView(run);
}
