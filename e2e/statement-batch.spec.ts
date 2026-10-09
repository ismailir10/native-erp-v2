import { expect, test } from "@playwright/test";
import { unknownCsv } from "../tests/unknown-layout";
import { addClient, briCsv } from "./qa-helpers";

/**
 * Many statements in one go: three months of one account dropped in scrambled order with a copy of June, a file of another account and
 * a file no reader knows. Buku reads them all first, imports the four it can oldest first (the copy is "sudah ada"), names the two it
 * can't, and a second drop of the same folder changes nothing. Synthetic files; months stay before August 2026.
 */
const ACCOUNT = "7000300001";
const month = (rows: string[]) => briCsv(ACCOUNT, rows);
const MEI = month(["2026-05-03;SETORAN MODAL;0.00;10000000.00;110000000.00", "2026-05-20;BIAYA LISTRIK;2000000.00;0.00;108000000.00"]);
const JUNI = month(["2026-06-04;PENJUALAN TUNAI;0.00;5000000.00;113000000.00", "2026-06-18;BIAYA AIR;1000000.00;0.00;112000000.00"]);
const JULI = month(["2026-07-02;PENJUALAN TUNAI;0.00;3000000.00;115000000.00", "2026-07-15;BIAYA INTERNET;500000.00;0.00;114500000.00"]);
const LAIN = briCsv("7999999999", ["2026-06-04;SETORAN;0.00;1000000.00;1000000.00"]);
const csv = (name: string, data: string | Buffer) => ({ name, mimeType: "text/csv", buffer: Buffer.from(data) });

test("drop many statements: read first, oldest first, one result; a second drop changes nothing", async ({ page }) => {
  await addClient(page, { name: "Banyak File Uji", account: ACCOUNT });
  const files = [csv("bri-jul.csv", JULI), csv("bri-mei.csv", MEI), csv("bri-juni.csv", JUNI), csv("bri-juni-salinan.csv", JUNI), csv("kas-aneh.csv", unknownCsv(8)), csv("rekening-lain.csv", LAIN)];
  await page.getByTestId("file-input").setInputFiles(files);

  const batch = page.getByTestId("batch-import");
  await expect(batch).toContainText("Impor 6 file");
  const queue = page.getByTestId("batch-queue");
  await expect(queue).toContainText("4 siap diimpor, dari bulan terlama");
  // Oldest first, whatever order the files were chosen in; the copy of June follows June.
  const names = await page.getByTestId("batch-row").evaluateAll((rows) => rows.map((r) => r.querySelector(".font-medium")?.textContent));
  expect(names).toEqual(["bri-mei.csv", "bri-juni.csv", "bri-juni-salinan.csv", "bri-jul.csv"]);
  await expect(queue).toContainText("Mei 2026");
  // The single-file form waits until the batch is cleared.
  await expect(page.getByTestId("import-result")).toBeHidden();

  // What Buku can't do alone is named, and doesn't hold the others back.
  const attention = page.getByTestId("batch-attention");
  await expect(attention).toContainText("2 perlu ditangani");
  await expect(attention).toContainText("Kolom tanggal & keterangan tidak ditemukan");
  await expect(attention).toContainText("bukan rekening klien ini");
  await page.screenshot({ path: "test-results/batch-import-1440.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/batch-import-390.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1440, height: 900 });

  await batch.getByRole("button", { name: "Impor 4 file" }).click();
  const summary = page.getByTestId("batch-summary");
  await expect(summary).toContainText("3 file diimpor · 1 sudah ada");
  await expect(summary).toContainText("6 transaksi baru");
  await expect(page.getByTestId("batch-status").filter({ hasText: "Saldo nyambung" })).toHaveCount(3);
  await expect(page.getByTestId("batch-status").filter({ hasText: "Sudah ada" })).toHaveCount(1);
  await page.screenshot({ path: "test-results/batch-import-done.png", fullPage: true });

  // The folder again: every file is already on file, nothing doubles.
  await batch.getByRole("button", { name: "Selesai" }).click();
  await expect(batch).toBeHidden();
  await page.getByTestId("file-input").setInputFiles([files[0], files[1], files[2]]);
  await expect(page.getByTestId("batch-queue")).toContainText("3 siap diimpor");
  await page.getByRole("button", { name: "Impor 3 file" }).click();
  await expect(page.getByTestId("batch-summary")).toContainText("0 file diimpor · 3 sudah ada");
  await expect(page.getByTestId("batch-summary")).toContainText("0 transaksi baru");

  // A file Buku can't read goes on alone, already loaded in the single form.
  await page.getByRole("button", { name: "Selesai" }).click();
  await page.getByTestId("file-input").setInputFiles([files[4], files[5]]);
  await page.getByRole("button", { name: "Tangani satu per satu (Atur kolom)" }).click();
  await expect(batch).toBeHidden();
  await expect(page.getByRole("button", { name: /kas-aneh\.csv/ })).toBeVisible();
  await page.getByRole("button", { name: "Proses mutasi" }).click();
  await expect(page.getByTestId("mappable-notice")).toBeVisible();
});
