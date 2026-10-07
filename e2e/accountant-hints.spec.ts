import { expect, test, type Locator, type Page } from "@playwright/test";
import { addClient, uploadStatement } from "./qa-helpers";

/**
 * What an Indonesian reviewer checks before accepting a line (accounting-rules 13b): a machine bought as an expense, a customer's down
 * payment booked as revenue, a consultant paid by a company without PPh 23, and building rent without PPh 4(2). Each hint offers a
 * one-click fill and disappears once handled; the accountant still saves. Then the request to the client carries the upload link.
 */
const CSV = [
  "Tanggal;Keterangan;Debet;Kredit;Saldo",
  "01/08/2026;SALDO AWAL;;;1.000.000.000,00",
  "05/08/2026;SEWA RUKO KANTOR AGUSTUS;45.000.000,00;0,00;955.000.000,00",
  "19/08/2026;PEMBELIAN MESIN PAKAN OTOMATIS;185.000.000,00;0,00;770.000.000,00",
  "21/08/2026;JASA KONSULTAN PAJAK HARAPAN;15.000.000,00;0,00;755.000.000,00",
  "22/08/2026;TRANSFER DP PESANAN CV MAJU;0,00;60.000.000,00;815.000.000,00",
  "",
].join("\n");

async function pick(page: Page, item: Locator, account: string) {
  await item.getByRole("combobox", { name: "Akun", exact: true }).click();
  await page.getByRole("combobox", { name: "Cari akun" }).fill(account);
  await page.keyboard.press("Enter");
}

test("Review hints catch capex, down payments and missing withholding; the request carries the upload link", async ({ page }) => {
  const id = await addClient(page, { name: "QA Petunjuk" });
  await uploadStatement(page, id, "petunjuk.csv", CSV);
  await expect(page.getByTestId("import-result")).toContainText("Nyambung");
  await page.goto(`/clients/${id}/review?period=2026-08`);
  const items = page.getByTestId("review-item");
  await expect(items).toHaveCount(4);

  const machine = items.filter({ hasText: "MESIN PAKAN" });
  await pick(page, machine, "5100");
  await expect(machine.getByTestId("review-hints")).toContainText("Pembelian mesin biasanya aset tetap");
  await machine.getByRole("button", { name: "Pakai 1210" }).click();
  await expect(machine.getByTestId("review-hints")).toHaveCount(0);
  await expect(machine.getByRole("combobox", { name: "Akun", exact: true })).toContainText("1210");

  const consultant = items.filter({ hasText: "JASA KONSULTAN" });
  await pick(page, consultant, "6170");
  await expect(consultant.getByTestId("review-hints")).toContainText("dipotong PPh 23 2%");
  await consultant.getByRole("button", { name: "Potong PPh 23 2%" }).click();
  await expect(consultant.getByTestId("withholding")).toContainText("bruto");
  await expect(consultant.getByTestId("review-hints")).toHaveCount(0);

  const rent = items.filter({ hasText: "SEWA RUKO" });
  await pick(page, rent, "6120");
  await expect(rent.getByTestId("review-hints")).toContainText("PPh 4(2) final 10%");

  const dp = items.filter({ hasText: "DP PESANAN" });
  await pick(page, dp, "4100");
  await expect(dp.getByTestId("review-hints")).toContainText("Uang muka belum menjadi pendapatan");
  await dp.getByRole("button", { name: "Pakai 2160" }).click();
  await expect(dp.getByRole("combobox", { name: "Akun", exact: true })).toContainText("2160");

  // The lines still in Review make the request to the client; the upload link goes into the same message.
  await page.goto(`/clients/${id}/import?period=2026-08`);
  const request = page.getByTestId("data-request");
  await request.getByRole("button", { name: "Sisipkan tautan unggah" }).click();
  await expect(page.getByText("Tautan unggah ditambahkan ke pesan")).toBeVisible();
  await expect(request.getByLabel("Pesan permintaan data")).toHaveValue(/tanpa perlu akun \(berlaku sampai .+\):\nhttps?:\/\/[^\n]+\/kirim\/[A-Za-z0-9_-]{43}\n\nTerima kasih/);
  await expect(page.getByTestId("upload-link-row").first()).toContainText("Aktif");
});
