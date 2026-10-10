import { expect, test } from "@playwright/test";
import { addClient, uploadStatement } from "./qa-helpers";

/** Synthetic source defects: refusal must reach the accountant, and conflicting evidence must stay visible through close. */
test("refuses foreign currency and impossible dates, and lets the accountant resolve ambiguous date order", async ({ page }) => {
  const id = await addClient(page, { name: "QA Sumber Bank", account: "7088100001" });
  await uploadStatement(page, id, "foreign.csv", [
    "Currency: USD",
    "Tanggal;Keterangan;Debet;Kredit;Saldo",
    "01/08/2026;SALDO AWAL;;;100.00",
    "03/08/2026;SETORAN;;10.50;110.50",
    "",
  ].join("\n"));
  await expect(page.locator("[data-sonner-toast]")).toContainText(/USD.*belum didukung/);
  await page.goto(`/clients/${id}/import`);
  await expect(page.getByText("Belum ada rekening koran yang diimpor untuk klien ini.")).toBeVisible();

  await uploadStatement(page, id, "impossible-date.csv", [
    "Tanggal;Keterangan;Debet;Kredit;Saldo",
    "01/02/2026;SALDO AWAL;;;1.000,00",
    "31/02/2026;SETORAN;;100,00;1.100,00",
    "",
  ].join("\n"));
  await expect(page.locator("[data-sonner-toast]")).toContainText(/kalender/);
  await page.goto(`/clients/${id}/import`);
  await expect(page.getByText("Belum ada rekening koran yang diimpor untuk klien ini.")).toBeVisible();

  await uploadStatement(page, id, "date-order.csv", [
    "Date;Description;Debit;Credit;Balance",
    "04/01/2026;OPENING BALANCE;;;1000",
    "04/01/2026;DEPOSIT;;100;1100",
    "04/02/2026;DEPOSIT;;200;1300",
    "",
  ].join("\n"));
  const notice = page.getByTestId("mappable-notice");
  await expect(notice).toContainText("Urutan tanggal ambigu");
  await notice.getByRole("button", { name: "Atur kolom" }).click();
  const mapper = page.getByTestId("column-mapper");
  await mapper.getByRole("combobox", { name: "Urutan tanggal" }).click();
  await page.getByRole("option", { name: "Bulan/hari (08/31)", exact: true }).click();
  await expect(mapper.getByRole("combobox", { name: "Urutan tanggal" })).toContainText("Bulan/hari (08/31)");
  await expect(page.getByTestId("mapping-preview")).toContainText("2 transaksi terbaca");
  await page.screenshot({ path: "test-results/bank-source-date-order.png", fullPage: true });
});

test("keeps a contradictory printed closing visible and fails bank reconciliation and completeness", async ({ page }) => {
  const id = await addClient(page, { name: "QA Konflik Saldo", account: "7088100002" });
  await uploadStatement(page, id, "closing-conflict.csv", [
    "Periode: 01/08/2026 - 31/08/2026",
    "Tanggal;Keterangan;Debet;Kredit;Saldo",
    "01/08/2026;SALDO AWAL;;;1.000,00",
    "03/08/2026;SETORAN;;100,00;1.100,00",
    "31/08/2026;SALDO AKHIR;;;900,00",
    "",
  ].join("\n"));
  await expect(page.getByTestId("import-result")).toContainText("Ada celah");
  await expect(page.getByTestId("import-notes")).toContainText("saldo akhir tercetak dipertahankan");
  await page.goto(`/clients/${id}/import`);
  await expect(page.getByRole("row", { name: /closing-conflict\.csv/ }).filter({ hasText: "saldo akhir tercetak dipertahankan" })).toContainText("saldo akhir tercetak dipertahankan");
  await page.goto(`/clients/${id}/close?period=2026-08`);
  await expect(page.getByTestId("control-bank")).toContainText("Gagal");
  await expect(page.getByTestId("control-cont")).toContainText("Gagal");
  await expect(page.getByTestId("control-cont")).toContainText(/saldo|Saldo/);
  await page.screenshot({ path: "test-results/bank-source-closing-conflict.png", fullPage: true });
});
