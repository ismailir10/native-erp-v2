import { expect, test } from "@playwright/test";

test("anonymous routes require an invitation session and login has no signup", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  for (const route of ["/", "/documents", "/reports", "/work", "/settings"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Masuk ke ruang kerja" })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: /daftar|sign up/i })).toHaveCount(0);
  await page.getByLabel("Email yang diundang").fill("not-invited@example.test");
  await page.getByRole("button", { name: "Kirim kode masuk", exact: true }).click();
  await expect(page.getByLabel("Kode masuk 6 angka")).toBeVisible();
  await page.getByLabel("Kode masuk 6 angka").fill("000000");
  await page.getByRole("button", { name: "Masuk ke Buku", exact: true }).click();
  await expect(page.locator("#login-error")).toContainText("Kode tidak cocok");
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
  await expect(answer).toContainText("Semua klien · Agustus 2026");
  await expect(answer).toContainText("dihitung dari jurnal Buku");
  await page.getByRole("combobox", { name: "Klien atau perusahaan" }).click();
  await page.getByRole("option", { name: "Perusahaan · PT Ayam Nusantara Digital", exact: true }).click();
  await expect(page).toHaveURL(/scope=entity/);
  await page.getByLabel("Periode", { exact: true }).fill("2026-07");
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
  await page.getByLabel("Periode", { exact: true }).fill("2027-01");
  await expect(page.getByText("Belum ada jurnal bulan ini.", { exact: false }).first()).toBeVisible();
});
