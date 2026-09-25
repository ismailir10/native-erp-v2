"use server";

import { prisma } from "@/lib/db";
import { getCurrentFirm } from "@/lib/tenant";
import { askWorkspace, WorkspaceInputError, type WorkspaceInput } from "@/lib/workspace";

export async function askWorkspaceAction(input: WorkspaceInput & { question: string }) {
  // Keep authentication outside the error boundary so session redirects are preserved.
  const firm = await getCurrentFirm();
  try {
    if (!input || typeof input.question !== "string" || (input.scope !== undefined && typeof input.scope !== "string") || (input.period !== undefined && typeof input.period !== "string")) throw new WorkspaceInputError("Pertanyaan atau cakupan tidak valid.");
    return { ok: true as const, answer: await askWorkspace(prisma, firm.id, input) };
  } catch (error) {
    return { ok: false as const, error: error instanceof WorkspaceInputError ? error.message : "Jawaban belum dapat dimuat. Coba lagi." };
  }
}
