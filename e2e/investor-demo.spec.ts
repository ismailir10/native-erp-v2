import { expect, test, type Page } from "@playwright/test";

/** The 5-minute investor walk (docs/demo/investor-demo.md), end to end. */

test("public Dokumen demo answers from synthetic reports and opens exact citations", async ({ page }) => {
  test.skip(process.env.DEMO_MODE === "false", "Public synthetic demonstration uses demo mode.");
  await page.goto("/");
  await page.getByRole("link", { name: "Dokumen", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dokumen", exact: true })).toBeVisible();
  await expect(page.getByText("Demo publik · perusahaan dan angka rekaan")).toBeVisible();
  await expect(page.getByRole("button", { name: "Hubungkan Google" })).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Bandingkan pendapatan", exact: true }).click();
  const answer = page.getByRole("region", { name: "Jawaban dokumen contoh" });
  await expect(answer).toContainText("US$ 250,00");
  await answer.getByRole("link", { name: "Laporan keuangan 2024.txt · baris 5", exact: true }).click();
  await expect(page.locator(':target')).toContainText("Pendapatan: 1250.00");
  await page.getByRole("button", { name: "Bukti apa yang kurang?", exact: true }).click();
  await expect(answer).toContainText("tidak dapat disimpulkan");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto("/documents/source/private-version");
  await expect(page.getByRole("heading", { name: "Halaman tidak ditemukan" })).toBeVisible();
});

async function pickOption(page: Page, trigger: ReturnType<Page["locator"]>, name: RegExp) {
  await trigger.click();
  await page.getByRole("option", { name }).click();
}

test("statement in → reviewed → traceable reports → combined → closed", async ({ page }) => {
  // 1. Beranda points at the client that needs work
  await page.goto("/");
  await expect(page.getByTestId("next-step")).toContainText("Grup Ayam Nusantara");
  await page.getByTestId("next-step").getByRole("link", { name: "Kerjakan" }).click();

  // 2. Live upload of the held-back BRI statement
  await expect(page.getByRole("heading", { name: "Impor Mutasi" })).toBeVisible();
  await page.getByRole("button", { name: /Pakai file contoh/ }).click();
  const result = page.getByTestId("import-result");
  await expect(result).toContainText("perlu review");
  await expect(result).toContainText("Nyambung");
  await expect(result).toContainText("0 panggilan");

  // 3. Review: fix the AI's wrong guess (machine = fixed asset), accept the rest with Enter
  await result.getByRole("link", { name: /Review \d+ transaksi/ }).click();
  const items = page.getByTestId("review-item");
  await expect(items).toHaveCount(5);
  const machine = items.filter({ hasText: "AGRO TEKNIK" });
  await pickOption(page, machine.getByRole("combobox", { name: "Akun" }), /^1210 Aset Tetap/);
  await machine.getByTestId("accept").click();
  await expect(items).toHaveCount(4);
  for (let n = 4; n > 0; n--) {
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Enter");
    await expect(items).toHaveCount(n - 1);
  }
  await expect(page.getByText("Antrean kosong")).toBeVisible();

  // 4. Every number traces to its bank row: P&L → account → ledger line → statement row
  await page.getByRole("link", { name: "Laporan Keuangan" }).click();
  await expect(page.getByRole("heading", { name: "Laporan Keuangan" })).toBeVisible();
  await page.getByTestId("fs-account-link").filter({ hasText: "4100 Penjualan" }).first().click();
  await expect(page.getByRole("heading", { name: /4100 Penjualan/ })).toBeVisible();
  await page.getByTestId("ledger-row").first().click();
  await expect(page.getByTestId("source-row")).toContainText("baris");

  // 5. Combined view eliminates intercompany once both sides are in
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Laporan Keuangan" }).click();
  await page.getByRole("tab", { name: "Kertas Kerja Gabungan" }).click();
  await expect(page.getByText("Antar entitas cocok")).toBeVisible();

  // 6. Accrual adjustment: August depreciation
  await page.getByRole("link", { name: "Jurnal Penyesuaian" }).click();
  await expect(page.getByRole("heading", { name: "Jurnal Penyesuaian" })).toBeVisible();
  await expect(page.getByRole("combobox").first()).toContainText("PT Ayam Nusantara Digital");
  await page.getByRole("button", { name: "Penyusutan" }).click();
  const amounts = page.locator("input[inputmode=numeric]");
  await amounts.nth(0).fill("9.500.000");
  await amounts.nth(3).fill("9.500.000");
  await expect(page.getByText("Seimbang", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Simpan jurnal" }).click();
  await expect(page.getByText("Jurnal penyesuaian tersimpan")).toBeVisible();

  // 7. Close: all controls pass → sign-offs → lock
  await page.getByRole("link", { name: "Tutup Buku" }).click();
  await expect(page.getByRole("heading", { name: "Tutup Buku" })).toBeVisible();
  await expect(page.getByText("Lolos").first()).toBeVisible();
  await expect(page.getByText("Perlu dicek")).toHaveCount(0);
  await expect(page.getByText("Gagal")).toHaveCount(0);
  const boxes = page.getByRole("checkbox");
  for (let i = 0; i < (await boxes.count()); i++) {
    await expect(boxes.nth(i)).toBeEnabled();
    await boxes.nth(i).click();
    await expect(boxes.nth(i)).toBeChecked();
  }
  await expect(page.getByTestId("lock")).toBeEnabled();
  await page.getByTestId("lock").click();
  await expect(page.getByText("Buku Agustus 2026 sudah ditutup")).toBeVisible();
});
