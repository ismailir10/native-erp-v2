import { expect, test } from "@playwright/test";
import { CENSUS_CSV, mortalityCsv } from "../tests/benefits-fixture";

/**
 * Employee benefits (PSAK 24), end to end (synthetic table and census): upload the firm's mortality table → assumptions → import the census
 * → DBO at December 2026 → the journal (first year: prior periods to Saldo Laba) → the December control passes.
 */
test("employee benefits: table, assumptions, census, valuation, journal, control", async ({ page }) => {
  await page.goto("/clients/new");
  await page.getByLabel("Nama klien").fill("Grup Uji Imbalan");
  await page.getByLabel("Nama lengkap").fill("PT Imbalan Uji");
  await page.getByLabel("Nama singkat").fill("IMB");
  await page.getByLabel("Nomor rekening").fill("4433221100");
  await page.getByRole("button", { name: "Simpan klien" }).click();
  await page.waitForURL(/\/clients\/[^/]+\/opening/);
  const base = page.url().replace(/\/opening.*$/, "");

  await page.goto(`${base}/benefits?period=2026-12`);
  await expect(page.getByRole("heading", { name: "Imbalan Kerja (PSAK 24)" })).toBeVisible();
  const card = page.getByTestId("benefits-IMB");

  // The firm's mortality table (a made-up one here, never a copy of TMI IV).
  await card.getByRole("button", { name: "Unggah tabel mortalita" }).click();
  await page.getByLabel("Nama tabel").fill("Tabel uji e2e");
  await page.getByLabel("File").setInputFiles({ name: "mortalita.csv", mimeType: "text/csv", buffer: mortalityCsv() });
  await page.getByRole("button", { name: "Unggah", exact: true }).click();
  await expect(page.getByText("Tabel Tabel uji e2e diunggah")).toBeVisible();

  await card.getByRole("combobox", { name: "Tabel mortalita" }).click();
  await page.getByRole("option", { name: "Tabel uji e2e" }).click();
  await card.getByLabel("Tingkat diskonto per tahun").fill("7");
  await card.getByLabel("Kenaikan gaji per tahun").fill("5");
  await card.getByRole("button", { name: "Simpan asumsi" }).click();
  await expect(page.getByText("Asumsi disimpan")).toBeVisible();

  await page.getByTestId("census-input").setInputFiles({ name: "sensus.csv", mimeType: "text/csv", buffer: Buffer.from(CENSUS_CSV) });
  await expect(page.getByText("Sensus diimpor: 4 ditambahkan, 0 diperbarui")).toBeVisible();
  await expect(card.getByTestId("employee-Budi Santoso")).toContainText("194.834.426");
  await expect(card.getByTestId("employee-Rina Lestari")).toContainText("keluar 30 Jun 2026");

  const valuation = page.getByTestId("valuation-IMB");
  await expect(valuation.getByTestId("eb-dbo")).toContainText("212.890.836");
  await expect(valuation).toContainText("Saldo Laba");
  await page.goto(`${base}/close?period=2026-12`);
  await expect(page.getByTestId("control-eb")).toContainText("jurnal valuasi belum dicatat");
  await page.goto(`${base}/benefits?period=2026-12`);
  await page.getByRole("button", { name: "Catat jurnal imbalan kerja per Desember 2026" }).click();
  await expect(page.getByText("Jurnal imbalan kerja dicatat")).toBeVisible();
  await expect(page.getByTestId("valuation-IMB")).toContainText("Liabilitas di buku besar sudah sesuai valuasi");
  await page.goto(`${base}/close?period=2026-12`);
  await expect(page.getByTestId("control-eb")).toContainText("sesuai valuasi (3 karyawan)");

  if (process.env.E2E_SCREENSHOTS) {
    await page.goto(`${base}/benefits?period=2026-12`);
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/benefits-1440.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/benefits-390.png`, fullPage: true });
  }
});
