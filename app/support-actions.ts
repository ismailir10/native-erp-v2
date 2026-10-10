"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { endSupportSession, logSupportView, resolveSupportSession, startSupportSession, SUPPORT_COOKIE, SUPPORT_MINUTES, SupportError } from "@/lib/auth/support";

/** Support sessions from the backoffice (ADR 0017 §2). Buku admins only; the session itself is recorded in lib/auth/support.ts. */
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function refusal(e: unknown) {
  if (e instanceof SupportError || (e instanceof Error && e.message === "Hanya admin Buku yang dapat mengubah ini.")) return { ok: false as const, error: e.message };
  console.error("support action", e instanceof Error ? e.message : e);
  return { ok: false as const, error: "Mode dukungan belum bisa dibuka. Coba lagi." };
}

export async function startSupportAction(firmId: string, asMemberId: string, reason: string): Promise<Result> {
  try {
    const admin = await requirePlatformAdmin({ refuse: "error" });
    const session = await startSupportSession(prisma, { adminId: admin.id, aal: admin.aal, firmId: String(firmId), asMemberId: String(asMemberId), reason: String(reason ?? "") });
    (await cookies()).set(SUPPORT_COOKIE, session.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SUPPORT_MINUTES * 60 });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return refusal(e);
  }
}

export async function endSupportAction(): Promise<Result<{ firmId: string | null }>> {
  try {
    const admin = await requirePlatformAdmin({ refuse: "error" });
    const store = await cookies();
    const id = store.get(SUPPORT_COOKIE)?.value;
    store.delete(SUPPORT_COOKIE);
    const session = id ? await endSupportSession(prisma, admin.id, id) : null;
    revalidatePath("/", "layout");
    return { ok: true, firmId: session?.firmId ?? null };
  } catch (e) {
    return refusal(e);
  }
}

/** One line per page the admin opens during the session (the support bar calls it on every navigation). */
export async function logSupportViewAction(path: string): Promise<Result> {
  try {
    const admin = await requirePlatformAdmin({ refuse: "error" });
    const id = (await cookies()).get(SUPPORT_COOKIE)?.value;
    const live = id ? await resolveSupportSession(prisma, admin.userId, admin.aal, id) : null;
    if (live) await logSupportView(prisma, live.session.id, String(path ?? ""));
    return { ok: true };
  } catch (e) {
    return refusal(e);
  }
}
