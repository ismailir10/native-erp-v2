import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, type FullConfig } from "@playwright/test";

/** Seed + create the e2e member (Prisma ESM fixture via tsx), then sign in through the real login form once. */
export default async function setup(config: FullConfig) {
  execSync("npx tsx scripts/e2e-setup.ts", { stdio: "inherit", env: process.env });
  const { email, password } = JSON.parse(readFileSync(".playwright/credentials.json", "utf8")) as { email: string; password: string };
  const { baseURL, launchOptions } = config.projects[0].use;
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage({ baseURL });
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Kata sandi").fill(password);
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    try {
      await page.getByRole("heading", { name: "Beranda", exact: true }).waitFor({ timeout: 30_000 });
    } catch (error) {
      // Say what the login page showed instead of a bare timeout (CI runs a throwaway Supabase stack).
      const shown = await page.locator("#login-error, [role=alert], [role=status]").allTextContents().catch(() => []);
      console.error(`e2e login failed at ${page.url()} — page said: ${shown.join(" | ") || "(nothing)"}`);
      throw error;
    }
    writeFileSync(".playwright/auth.json", JSON.stringify(await page.context().storageState()), { mode: 0o600 });
  } finally { await browser.close(); }
}
