import { defineConfig } from "@playwright/test";

/**
 * E2E walks docs/demo/investor-demo.md against a real server + Postgres.
 * Locally: reuses a running `npm run dev` on :3100 if BASE_URL is set; CI: builds and starts.
 */
const port = 3200;
// Auth is the local Supabase stack (ADR 0015): CI runs `supabase start`, a laptop `npm run auth:local`. Never production.
process.env.APP_URL ??= process.env.BASE_URL ?? `http://localhost:${port}`;
process.env.EVIDENCE_ENABLED ??= "true";
export default defineConfig({
  testDir: "e2e",
  // The usability sweep (every page × desktop/phone, screenshots) runs on demand: `npm run ux:sweep`.
  testIgnore: process.env.UX_SWEEP ? [] : ["**/ux-sweep.spec.ts"],
  timeout: 90_000,
  workers: 1,
  retries: 0,
  globalSetup: "./e2e/global-setup.ts",
  use: {
    storageState: ".playwright/auth.json",
    baseURL: process.env.BASE_URL ?? `http://localhost:${port}`,
    viewport: { width: 1440, height: 900 },
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : undefined,
    trace: "retain-on-failure",
  },
  webServer: process.env.BASE_URL
    ? undefined
    : { command: `npm run start -- -p ${port}`, port, reuseExistingServer: true, timeout: 120_000 },
});
