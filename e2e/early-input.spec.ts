import { expect, test } from "@playwright/test";

/**
 * Typing right after a full page load (production E2E 2026-09-30): the server HTML is usable before React attaches. React keeps
 * what was typed into a controlled field then; this guards it (and Beranda's scope URL, which no longer re-renders the page).
 */
test("text typed before the page is interactive is kept (client form, Tanya Buku)", async ({ page }) => {
  // Hold the app's JavaScript back like a slow connection does, so the typing happens on the server HTML before React attaches.
  await page.route("**/_next/static/chunks/**", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.goto("/clients/new", { waitUntil: "domcontentloaded" });
  const name = page.locator("#client-name");
  await name.fill("Klien Ketik Cepat");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  await expect(name).toHaveValue("Klien Ketik Cepat");

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const question = page.locator("#workspace-question");
  await question.fill("Apa yang perlu ditanyakan ke klien?");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  await expect(question).toHaveValue("Apa yang perlu ditanyakan ke klien?");
  // Beranda names its scope in the URL without reloading the page.
  await expect(page).toHaveURL(/[?&]scope=.+&period=\d{4}-\d{2}|[?&]period=\d{4}-\d{2}.*&scope=/);
  await expect(page.getByRole("button", { name: "Tanya Buku" })).toBeEnabled();
});
