import type { Db } from "@/lib/db";
import { ensureLocalAdmin } from "@/lib/auth/operator";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { supabaseEnv, supabaseSecretKey } from "@/lib/supabase/env";

/**
 * After a demo seed: the demo admin login, when `DEMO_ADMIN_EMAIL` + `DEMO_ADMIN_PASSWORD` are set.
 * Never in a real workspace — the password would be a shared secret in an env var.
 */
export async function seedDemoAdmin(db: Db, log: (line: string) => void = () => {}) {
  const email = process.env.DEMO_ADMIN_EMAIL;
  const password = process.env.DEMO_ADMIN_PASSWORD;
  if (!email || !password) return null;
  if (process.env.DEMO_MODE !== "true") throw new Error("DEMO_ADMIN_* hanya untuk DEMO_MODE=true. Gunakan `npm run access -- invite` untuk ruang kerja sungguhan.");
  if (!supabaseEnv() || !supabaseSecretKey()) { log("Demo admin dilewati: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY belum diatur."); return null; }
  const firm = await db.firm.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const member = await ensureLocalAdmin(db, createSupabaseAdmin().auth.admin, { email, password, name: process.env.DEMO_ADMIN_NAME ?? "Admin Demo", firmId: firm.id });
  log(`Demo admin siap: ${member.email} (ADMIN, ${firm.name})`);
  return member;
}
