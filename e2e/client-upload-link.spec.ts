import { expect, test } from "@playwright/test";
import { addClient } from "./qa-helpers";

/**
 * Tautan unggah klien (I1d): the firm makes a link, a client with no account sends a statement through it, the firm finds the file in
 * Dokumen, and a revoked link stops working with the same page an unknown link shows.
 */
const CSV = ["Tanggal;Keterangan;Debet;Kredit;Saldo", "01/08/2026;SALDO AWAL;;;1.000.000,00", "05/08/2026;BIAYA ADMIN;10.000,00;0,00;990.000,00", ""].join("\n");

test("a client sends a file through an upload link without an account; a revoked link stops working", async ({ page, browser, baseURL }) => {
  const id = await addClient(page, { name: "QA Tautan" });
  await page.goto(`/clients/${id}/import`);
  const card = page.getByTestId("upload-links");
  await card.getByRole("button", { name: "Buat tautan unggah" }).click();
  const url = await page.getByLabel("Tautan unggah").inputValue();
  expect(url).toMatch(/\/kirim\/[A-Za-z0-9_-]{43}$/);

  const anonymous = await browser.newContext({ baseURL });
  const client = await anonymous.newPage();
  await client.goto(new URL(url).pathname);
  await expect(client.getByRole("heading", { name: /Kirim dokumen ke/ })).toBeVisible();
  await expect(client.locator("body")).toContainText("Untuk QA Tautan");
  await client.getByTestId("link-file").setInputFiles({ name: "bca-agustus.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await expect(client.getByTestId("link-received")).toContainText("Terkirim");
  await client.getByTestId("link-file").setInputFiles({ name: "foto.pdf", mimeType: "application/pdf", buffer: Buffer.from("bukan pdf") });
  await expect(client.getByTestId("link-received")).toContainText("tidak sesuai jenis filenya");

  await page.reload();
  await expect(page.getByTestId("upload-link-row").first()).toContainText("1 file diterima");
  await page.getByTestId("upload-link-row").first().getByRole("link", { name: "Buka file" }).click();
  await expect(page.locator("body")).toContainText("bca-agustus.csv");

  await page.goto(`/clients/${id}/import`);
  await page.getByTestId("upload-link-row").first().getByRole("button", { name: "Cabut" }).click();
  await expect(page.getByText("Tautan dicabut")).toBeVisible();
  const gone = await client.goto(new URL(url).pathname);
  expect(gone?.status()).toBe(404);
  await expect(client.getByRole("heading", { name: "Tautan tidak berlaku" })).toBeVisible();
  const unknown = await client.goto(`/kirim/${"A".repeat(43)}`);
  expect(unknown?.status()).toBe(404);
  await anonymous.close();
});
