"use server";

import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { askWorkspace, WorkspaceInputError, type WorkspaceInput } from "@/lib/workspace";

export async function askWorkspaceAction(input: WorkspaceInput & { question: string }) {
  let firm;
  // An answer may call the AI (budget), so it is refused while read-only, like every other AI call. The refusal is the form's message.
  try { ({ firm } = await requireCapability("books.write")); }
  catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Masuk terlebih dahulu." }; }
  try {
    if (!input || typeof input.question !== "string" || (input.scope !== undefined && typeof input.scope !== "string") || (input.period !== undefined && typeof input.period !== "string")) throw new WorkspaceInputError("Pertanyaan atau cakupan tidak valid.");
    return { ok: true as const, answer: await askWorkspace(prisma, firm.id, input) };
  } catch (error) {
    return { ok: false as const, error: error instanceof WorkspaceInputError ? error.message : "Jawaban belum dapat dimuat. Coba lagi." };
  }
}
