import "dotenv/config";
import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createPrisma } from "../lib/db";
import { ensureLocalAdmin } from "../lib/auth/operator";
import { createSupabaseAdmin } from "../lib/supabase/admin";

/**
 * Seed synthetic books and create the e2e member through the Supabase admin API (a real account with a
 * real password). The browser then logs in through the real form (e2e/global-setup.ts). No server bypass.
 */
async function setup() {
  const baseURL = process.env.BASE_URL ?? "http://localhost:3200";
  const database = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1", "::1"].includes(database.hostname) || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) throw new Error("E2E setup only accepts disposable localhost environments.");
  execSync("npx tsx scripts/seed.ts", { stdio: "inherit", env: process.env });
  const db = createPrisma();
  try {
    const firm = await db.firm.findFirstOrThrow();
    const email = process.env.E2E_EMAIL ?? "accountant@buku.example";
    const password = process.env.E2E_PASSWORD ?? randomBytes(12).toString("base64url");
    await ensureLocalAdmin(db, createSupabaseAdmin().auth, { email, password, name: "Akuntan uji", firmId: firm.id });
    mkdirSync(".playwright", { recursive: true });
    writeFileSync(".playwright/credentials.json", JSON.stringify({ email, password }), { mode: 0o600 });
  } finally { await db.$disconnect(); }
}

setup().catch(error => { console.error(error); process.exitCode = 1; });
