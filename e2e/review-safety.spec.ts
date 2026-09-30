import { expect, test } from "@playwright/test";

/**
 * Review never loses a correction (staging E2E 2026-09-29, H3/M1): an unsaved account survives a reload, one click on
 * *Simpan* saves even with the account list just used, and Enter moves straight on. Uses CV Sinar Retail (2 lines in review).
 */
test("an unsaved correction survives a reload; Simpan saves in one click; Enter accepts the next", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.type());
    void d.accept();
  });
  await page.goto("/");
  await page.getByRole("link", { name: "CV Sinar Retail", exact: true }).first().click();
  await page.getByRole("link", { name: "Review transaksi", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Review transaksi" })).toBeVisible();
  const items = page.getByTestId("review-item");
  await expect(items).toHaveCount(2);
  await expect(page.getByTestId("review-count")).toHaveText("2 menunggu");

  // Search and filters narrow the queue; nothing is lost.
  await page.getByRole("button", { name: /^Uang masuk/ }).click();
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("KOPERASI");
  await page.getByRole("button", { name: /^Semua/ }).click();
  await page.getByLabel("Cari transaksi").fill("rak display");
  await expect(items).toHaveCount(1);
  await page.getByLabel("Cari transaksi").fill("");
  await expect(items).toHaveCount(2);

  // Change the rack purchase to a fixed asset by typing on the closed picker: the keys land in its search and Enter picks the
  // first match. Then reload before saving.
  const rack = items.filter({ hasText: "RAK DISPLAY" });
  await rack.getByRole("combobox", { name: "Akun", exact: true }).focus();
  await page.keyboard.type("1210");
  await expect(page.getByRole("combobox", { name: "Cari akun" })).toHaveValue("1210");
  await page.keyboard.press("Enter");
  await expect(rack.getByTestId("unsaved")).toHaveText("Belum disimpan");
  await page.reload();
  expect(dialogs).toContain("beforeunload");
  await expect(rack.getByRole("combobox", { name: "Akun", exact: true })).toContainText("1210 Aset Tetap");
  await expect(rack.getByTestId("unsaved")).toBeVisible();

  // One click saves (the list is non-modal, so the click isn't swallowed by closing it).
  await rack.getByRole("combobox", { name: "Akun", exact: true }).click();
  await page.getByRole("option", { name: /^1210 Aset Tetap/ }).click();
  await rack.getByRole("button", { name: "Simpan", exact: true }).click();
  await expect(items).toHaveCount(1);
  await expect(page.getByTestId("review-count")).toHaveText("1 menunggu");
  await expect(page.getByTestId("review-saving")).toHaveCount(0);

  // Enter accepts the remaining line right away.
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Enter");
  await expect(page.getByText("Antrean kosong")).toBeVisible();
  await expect(page.getByTestId("review-saving")).toHaveCount(0);

  // Saved for real: after a reload nothing is waiting and no draft comes back.
  await page.reload();
  await expect(page.getByText("Antrean kosong")).toBeVisible();
});
