import { expect, test } from "@playwright/test";
import { addClient } from "./qa-helpers";

/**
 * PPh 21 Desember (PMK 168/2023): a census with PTKP status, then Pajak Masa for December recomputes each employee's year under Pasal 17
 * less TER January–November. Ani (TK/0, Rp 10 jt all year) is DJP's worked example: December Rp 800.000. Cici joined in July: lebih potong.
 * Dodi left in June: his last masa is the same recompute, not TER.
 */
const CENSUS = [
  "No;Nama;L/P;Tanggal Lahir;Tanggal Masuk;Gaji Pokok;Tunjangan Tetap;Tanggal Keluar;Status PTKP",
  "K-001;Ani Wulandari;P;15/03/1990;01/02/2015;10.000.000;0;;TK/0",
  "K-002;Cici Rahma;P;20/07/1995;01/07/2026;10.000.000;0;;TK/0",
  "K-003;Dodi Saputra;L;01/01/1988;01/01/2019;20.000.000;0;30/06/2026;TK/0",
  "",
].join("\n");

test("Pajak Masa December recomputes PPh 21 under Pasal 17 and shows a lebih potong", async ({ page }) => {
  const id = await addClient(page, { name: "QA PPh 21 Desember" });
  await page.goto(`/clients/${id}/benefits?period=2026-12`);
  await page.getByTestId("census-input").setInputFiles({ name: "sensus.csv", mimeType: "text/csv", buffer: Buffer.from(CENSUS) });
  await expect(page.getByText("Sensus diimpor: 3 ditambahkan, 0 diperbarui")).toBeVisible();

  await page.goto(`/clients/${id}/tax/masa?period=2026-12`);
  const card = page.getByTestId("masa-ter");
  await expect(card).toContainText("PPh 21 Desember (Pasal 17 setahun)");
  const table = card.getByTestId("pph21-annual");
  await expect(table.getByRole("row", { name: /Ani Wulandari/ })).toContainText("800.000");
  await expect(table.getByRole("row", { name: /Cici Rahma/ })).toContainText("(850.000)");
  await expect(card).toContainText("Estimasi PPh 21 Desember lebih potong Rp 50.000 (dikembalikan ke karyawan)");
  // Nothing was booked for December yet: the masa asks for a look.
  await expect(card).toContainText("Perlu dicek");

  // Dodi left on 30 June: June is his last masa, Pasal 17 for six months less TER January–May → lebih potong Rp 5.550.000.
  await page.goto(`/clients/${id}/tax/masa?period=2026-06`);
  const june = page.getByTestId("masa-ter");
  await expect(june.getByTestId("pph21-leavers").getByRole("row", { name: /Dodi Saputra/ })).toContainText("(5.550.000)");
  await expect(june).toContainText("tarif Pasal 17 setahun untuk 1 karyawan yang berhenti bulan ini");
});
