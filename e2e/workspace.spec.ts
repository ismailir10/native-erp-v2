import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const credentials = () => JSON.parse(readFileSync(".playwright/credentials.json", "utf8")) as { email: string; password: string };

test("anonymous routes require a member session and login has no signup", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  for (const route of ["/", "/documents", "/reports", "/work", "/settings"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Masuk ke ruang kerja" })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: /daftar|sign up/i })).toHaveCount(0);
  await page.getByLabel("Email").fill("not-invited@example.test");
  await page.getByLabel("Kata sandi").fill("bukan-kata-sandi");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page.locator("#login-error")).toContainText("Email atau kata sandi tidak cocok");
  await expect(page.getByLabel("Email")).toHaveValue("not-invited@example.test");
  await page.goto("/documents");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("link", { name: "Lupa kata sandi?" }).click();
  await expect(page.getByRole("heading", { name: "Lupa kata sandi" })).toBeVisible();
  await context.close();
});

test("a member signs in with email + password and signs out", async ({ browser }) => {
  const { email, password } = credentials();
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Beranda", exact: true })).toBeVisible();
  await expect(page.getByText("Akuntan uji · Admin")).toBeVisible();
  await page.getByRole("button", { name: "Keluar", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/documents");
  await expect(page).toHaveURL(/\/login$/);
  await context.close();
});

test("scope, period and answer context survive navigation at desktop and 390px", async ({ page }, testInfo) => {
  await page.goto("/?scope=all&period=2026-08");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Lewati navigasi" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#workspace-main")).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("workspace-desktop.png"), fullPage: true });
  await page.getByLabel("Apa yang ingin Anda periksa?").fill("Berapa laba tiap perusahaan?");
  await page.getByRole("button", { name: "Tanya Buku", exact: true }).click();
  const answer = page.getByRole("article", { name: "Jawaban: Berapa laba tiap perusahaan?" });
  await expect(answer).toContainText("Semua klien · Agustus 2026", { timeout: 30_000 });
  await expect(answer).toContainText("dihitung dari jurnal Buku");
  await page.getByRole("combobox", { name: "Klien atau perusahaan" }).click();
  await page.getByRole("option", { name: "Perusahaan · PT Ayam Nusantara Digital", exact: true }).click();
  await expect(page).toHaveURL(/scope=entity/);
  await page.getByRole("combobox", { name: "Periode" }).click();
  await page.getByRole("option", { name: "Juli 2026", exact: true }).click();
  await expect(page).toHaveURL(/period=2026-07/);
  await expect(answer).toContainText("Semua klien · Agustus 2026");
  await page.getByRole("link", { name: "Dokumen", exact: true }).click();
  await expect(page).toHaveURL(/scope=entity.*period=2026-07/);
  await page.getByRole("link", { name: "Laporan", exact: true }).click();
  await expect(page).toHaveURL(/scope=entity.*period=2026-07/);
  await page.getByRole("link", { name: "Beranda", exact: true }).click();
  await expect(answer).toContainText("Semua klien · Agustus 2026");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("workspace-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Buka navigasi" }).click();
  await expect(page.getByRole("button", { name: "Keluar", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("combobox", { name: "Periode" }).click();
  await page.getByRole("option", { name: "Januari 2026", exact: true }).click();
  await expect(page.getByText("Belum ada jurnal bulan ini.", { exact: false }).first()).toBeVisible();
});
