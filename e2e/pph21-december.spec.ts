import { expect, test } from "@playwright/test";
import { addClient } from "./qa-helpers";

/**
 * PPh 21 Desember (PMK 168/2023): a census with PTKP status, then Pajak Masa for December recomputes each employee's year under Pasal 17
 * less TER January–November. Ani (TK/0, Rp 10 jt all year) is DJP's worked example: December Rp 800.000. Cici joined in July: lebih potong.
 */
const CENSUS = [
  "No;Nama;L/P;Tanggal Lahir;Tanggal Masuk;Gaji Pokok;Tunjangan Tetap;Tanggal Keluar;Status PTKP",
  "K-001;Ani Wulandari;P;15/03/1990;01/02/2015;10.000.000;0;;TK/0",
  "K-002;Cici Rahma;P;20/07/1995;01/07/2026;10.000.000;0;;TK/0",
  "",
].join("\n");

test("Pajak Masa December recomputes PPh 21 under Pasal 17 and shows a lebih potong", async ({ page }) => {
  const id = await addClient(page, { name: "QA PPh 21 Desember" });
  await page.goto(`/clients/${id}/benefits?period=2026-12`);
  await page.getByTestId("census-input").setInputFiles({ name: "sensus.csv", mimeType: "text/csv", buffer: Buffer.from(CENSUS) });
  await expect(page.getByText("Sensus diimpor: 2 ditambahkan, 0 diperbarui")).toBeVisible();

  await page.goto(`/clients/${id}/tax/masa?period=2026-12`);
  const card = page.getByTestId("masa-ter");
  await expect(card).toContainText("PPh 21 Desember (Pasal 17 setahun)");
  const table = card.getByTestId("pph21-annual");
  await expect(table.getByRole("row", { name: /Ani Wulandari/ })).toContainText("800.000");
  await expect(table.getByRole("row", { name: /Cici Rahma/ })).toContainText("(850.000)");
  await expect(card).toContainText("Estimasi PPh 21 Desember lebih potong Rp 50.000 (dikembalikan ke karyawan)");
  // Nothing was booked for December yet: the masa asks for a look.
  await expect(card).toContainText("Perlu dicek");
});
