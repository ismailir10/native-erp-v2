import { cache } from "react";
import { notFound } from "next/navigation";
import { authConfigured } from "@/lib/auth";
import { prisma, type Db } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Buku admins (ADR 0017 §2): `PlatformAdmin` rows, created and removed only by the CLI (`npm run access -- operator …`), read live
 * on every request so removal takes effect at once. Separate from organisation membership: being a Buku admin opens /backoffice,
 * nothing in any organisation's workspace (that is a support session, T18).
 */
export async function resolvePlatformAdmin(db: Db, userId: string) {
  const admin = await db.platformAdmin.findUnique({ where: { userId } });
  return admin && !admin.disabled ? admin : null;
}

/** The verified Supabase user resolved to an active Buku admin, once per request; null for everyone else. */
export const getPlatformAdmin = cache(async () => {
  if (!authConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return null;
  const admin = await resolvePlatformAdmin(prisma, userId);
  return admin && { ...admin, aal: (data?.claims as { aal?: string } | undefined)?.aal ?? "aal1" };
});

/**
 * /backoffice pages: anyone who is not an active Buku admin gets a 404, never a hint that the page exists. Server actions pass
 * `{ refuse: "error" }` and get an Error to return as their message instead.
 */
export async function requirePlatformAdmin(opts: { refuse?: "404" | "error" } = {}) {
  const admin = await getPlatformAdmin();
  if (!admin) {
    if (opts.refuse === "error") throw new Error(NOT_PLATFORM_ADMIN);
    notFound();
  }
  return admin;
}

export const NOT_PLATFORM_ADMIN = "Hanya admin Buku yang dapat mengubah ini.";
