import { createPrisma } from "@/lib/db";
import { inviteUser } from "@/lib/auth/operator";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { appUrl, supabaseEnv, supabaseSecretKey } from "@/lib/supabase/env";
import { createFirm } from "@/lib/setup";

/**
 * Build-time first access, driven by env only (no database password leaves the platform):
 *   INITIAL_FIRM_NAME   — creates the firm when the database has none (production starts empty).
 *   INITIAL_ADMIN_EMAIL — invites that address as ADMIN into the first firm, once; re-runs are no-ops.
 * The invitation email comes from Supabase (its default sender reaches organisation members only until custom SMTP is set).
 */
async function main() {
  const firmName = process.env.INITIAL_FIRM_NAME?.trim();
  const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  if (!firmName && !email) return;
  const db = createPrisma();
  try {
    let firm = await db.firm.findFirst({ orderBy: { createdAt: "asc" } });
    if (!firm && firmName) { firm = await db.$transaction((tx) => createFirm(tx, firmName)); console.log(`✓ Kantor dibuat: ${firm.name}`); }
    if (!firm) { console.log("· Bootstrap admin dilewati: belum ada kantor (set INITIAL_FIRM_NAME)."); return; }
    if (!email) return;
    if (await db.firmMember.findUnique({ where: { email } })) { console.log(`✓ Admin awal sudah ada: ${email}`); return; }
    if (!supabaseEnv() || !supabaseSecretKey()) { console.log("· Bootstrap admin dilewati: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY belum diatur."); return; }
    const member = await inviteUser(db, createSupabaseAdmin().auth, { email, name: process.env.INITIAL_ADMIN_NAME?.trim() || email.split("@")[0], firmId: firm.id, role: "ADMIN", redirectTo: appUrl() || undefined });
    console.log(`✓ Undangan admin terkirim ke ${member.email} (${firm.name})`);
  } finally { await db.$disconnect(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
