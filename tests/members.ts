import { randomUUID } from "node:crypto";
import { db } from "./helpers";
import type { MemberRole } from "@/lib/generated/prisma/enums";

/**
 * A real organisation member for tests that drive server actions through the real guard (lib/auth/session.ts). Pair it with
 * the two identity mocks every such test declares:
 *
 *   const auth = vi.hoisted(() => ({ userId: null as string | null }));
 *   vi.mock("@/lib/auth", () => ({ authConfigured: () => true }));
 *   vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getClaims: async () => ({ data: auth.userId ? { claims: { sub: auth.userId } } : null }) } }) }));
 *
 * then sign in with `auth.userId = member.userId`.
 */
export async function addMember(firmId: string, role: MemberRole, opts: { name?: string; clients?: string[] } = {}) {
  const name = opts.name ?? role.toLowerCase();
  return db.firmMember.create({
    data: {
      firmId, userId: randomUUID(), email: `${name}-${randomUUID()}@example.test`, name, role,
      clientAccess: { create: (opts.clients ?? []).map((clientId) => ({ clientId })) },
    },
  });
}
