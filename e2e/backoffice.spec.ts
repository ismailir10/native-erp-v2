import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/**
 * The Buku backoffice (ADR 0017 §2, cycle 2026-10-09-trial-tenants-roles T06): a Buku admin signs in through the same form and lands
 * on the organisations list; an organisation member (the default e2e account) gets a 404 there. Accounts from scripts/e2e-setup.ts.
 */
test("a Buku admin lands on the organisations list with each one's access", async ({ browser, baseURL }) => {
  const { email, password } = JSON.parse(readFileSync(".playwright/credentials-ops.json", "utf8")) as { email: string; password: string };
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page.waitForURL(/\/backoffice$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Organisasi" })).toBeVisible();
  const rows = page.getByTestId("organisation-row");
  await expect(rows.filter({ hasText: "KJA Demo & Rekan" })).toContainText("tanpa batas");
  await expect(rows.filter({ hasText: "Uji Berakhir" })).toContainText("Hanya baca");
  await expect(rows.filter({ hasText: "PT Uji Perusahaan" })).toContainText("Perusahaan");
  // No client of any organisation is named here.
  await expect(page.locator("main")).not.toContainText("CV Sinar Retail");
  // Buku's AI key and OCR switch live here, and only here (ADR 0017 §6).
  await page.getByRole("link", { name: "Pengaturan AI" }).click();
  await expect(page.getByLabel("Kunci API baru")).toBeVisible();
  await expect(page.getByTestId("ocr-setting").getByRole("checkbox")).toBeVisible();
  // The workspace is not theirs: no membership, back to the backoffice.
  await page.goto("/");
  await page.waitForURL(/\/(login|backoffice)/);
});

test("an organisation member gets a 404 at the backoffice", async ({ page }) => {
  const response = await page.goto("/backoffice");
  expect(response?.status()).toBe(404);
});

test("a Buku admin creates a trial company, extends it with a paid grant, suspends and reinstates it", async ({ browser, baseURL }) => {
  const { email, password } = JSON.parse(readFileSync(".playwright/credentials-ops.json", "utf8")) as { email: string; password: string };
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page.waitForURL(/\/backoffice$/, { timeout: 30_000 });

  const name = `PT Coba ${Date.now()}`;
  const form = page.getByTestId("create-organisation");
  await form.getByLabel("Nama organisasi").fill(name);
  await form.getByRole("combobox", { name: "Jenis" }).click();
  await page.getByRole("option", { name: "Perusahaan" }).click();
  await form.getByRole("button", { name: "14 hari" }).click();
  await form.getByRole("button", { name: "Buat organisasi" }).click();
  await page.waitForURL(/\/backoffice\/orgs\//);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByTestId("grants")).toContainText("Uji coba");
  await expect(page.getByTestId("platform-events")).toContainText("dibuat");

  await page.getByTestId("grant-form").getByRole("button", { name: "Beri akses" }).click();
  await expect(page.getByTestId("grants")).toContainText("Berbayar");

  await page.getByTestId("suspend-form").getByLabel("Alasan").fill("Uji penangguhan");
  await page.getByRole("button", { name: "Tangguhkan" }).click();
  await expect(page.getByText("Ditangguhkan").first()).toBeVisible();
  await page.getByRole("button", { name: "Pulihkan" }).click();
  await expect(page.getByTestId("platform-events")).toContainText("Dipulihkan");
});
