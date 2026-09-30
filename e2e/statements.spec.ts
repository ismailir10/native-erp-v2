import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";

/**
 * The full statements on the demo agency (PT Jasa Kreatif Digital, closed through August 2026): marked final, no empty last-year column,
 * Neraca, Perubahan Ekuitas and Arus Kas reconcile, CALK drafted, and the whole set downloads as one workbook.
 */
test("financial statements: comparatives, equity, cash flow, notes, download", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "PT Jasa Kreatif Digital", exact: true }).first().click();
  await page.waitForURL(/\/clients\/[^/]+/);
  const base = page.url().match(/^.*\/clients\/[^/?]+/)![0];
  await page.goto(`${base}/reports?period=2026-08`);
  await expect(page.getByRole("heading", { name: "Laporan Keuangan" })).toBeVisible();
  await expect(page.getByTestId("report-status")).toContainText("Final");
  await expect(page.getByRole("columnheader", { name: "S.d. Agustus 2026" })).toBeVisible();
  // The demo books start in 2026: no column of dashes for last year.
  await expect(page.getByRole("columnheader", { name: "S.d. Agustus 2025" })).toHaveCount(0);

  await page.getByRole("tab", { name: "Neraca" }).click();
  await expect(page.getByText("Seimbang")).toBeVisible();
  await page.getByRole("tab", { name: "Perubahan Ekuitas" }).click();
  await expect(page.getByText("Sama dengan Neraca")).toBeVisible();
  await expect(page.getByTestId("equity-closing")).toBeVisible();
  await page.getByRole("tab", { name: "Arus Kas" }).click();
  await expect(page.getByText("Sama dengan kas di Neraca")).toBeVisible();
  await expect(page.getByTestId("cash-flow")).toContainText("Arus kas dari aktivitas operasi");
  await expect(page.getByTestId("cash-flow").getByTestId("fs-account-link").first()).toHaveAttribute("href", /\/ledger\/\d+/);
  await page.getByRole("tab", { name: "CALK" }).click();
  await expect(page.getByTestId("note-1")).toContainText("Umum");
  await expect(page.getByTestId("note-2")).toContainText("SAK EP");
  await expect(page.getByTestId("directors-statement")).toContainText("SURAT PERNYATAAN DIREKSI");

  const download = page.waitForEvent("download");
  await page.getByTestId("fs-download").click();
  const file = await (await download).path();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await readFile(file)) as unknown as ArrayBuffer);
  expect(wb.worksheets.map((w) => w.name)).toEqual(["Neraca", "Laba Rugi", "Perubahan Ekuitas", "Arus Kas", "CALK", "Pernyataan Direksi"]);

  if (process.env.E2E_SCREENSHOTS) {
    await page.getByRole("tab", { name: "Arus Kas" }).click();
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/cashflow-1440.png`, fullPage: true });
    await page.getByRole("tab", { name: "Perubahan Ekuitas" }).click();
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/equity-1440.png`, fullPage: true });
    await page.getByRole("tab", { name: "CALK" }).click();
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/notes-1440.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/notes-390.png`, fullPage: true });
    await page.getByRole("tab", { name: "Arus Kas" }).click();
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/cashflow-390.png`, fullPage: true });
  }
});
