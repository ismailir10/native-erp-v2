import { expect, test } from "@playwright/test";
import { addClient, uploadStatement } from "./qa-helpers";

/**
 * PPh 25 angsuran on Pajak Masa: July's instalment paid on 20 August (after the 15th). With no instalment set the row only asks for one;
 * once set (Rp 5.000.000 from April) the payment reads as late, the banner and Tutup Buku say so, and removing it goes back.
 */
const CSV = ["Tanggal;Keterangan;Debet;Kredit;Saldo", "01/08/2026;SALDO AWAL;;;100.000.000,00", "20/08/2026;SETORAN PPH 25 MASA JULI;5.000.000,00;0,00;95.000.000,00", ""].join("\n");

test("PPh 25: the instalment is set on Pajak Masa, and a late payment shows on the page and in Tutup Buku", async ({ page }) => {
  const id = await addClient(page, { name: "QA PPh 25" });
  await uploadStatement(page, id, "pph25.csv", CSV);
  await expect(page.getByTestId("import-result")).toContainText("Nyambung");

  await page.goto(`/clients/${id}/tax/masa?period=2026-08`);
  const row = page.getByTestId("masa-row-PPH_25");
  await expect(row).toContainText("Juli 2026 · Disetor");
  await expect(page.getByText("Angsuran PPh 25 per bulan belum diisi: isi dari SPT tahunan terakhir supaya setorannya bisa dicek.")).toBeVisible();

  const form = page.getByTestId("pph25-instalment");
  await form.getByLabel("Masa mulai angsuran").fill("2026-04");
  await form.getByLabel("Angsuran PPh 25 per bulan").fill("5.000.000");
  await form.getByTestId("pph25-save").click();
  await expect(page.getByText("Angsuran PPh 25 disimpan")).toBeVisible();
  await expect(form).toContainText("Angsuran Rp 5.000.000 per bulan mulai masa April 2026");
  await expect(row).toContainText("Juli 2026 · Disetor terlambat");
  await expect(row).toContainText("Perlu dicek");
  await expect(page.getByText("PPh 25: Masa Juli 2026: angsuran disetor setelah jatuh tempo 15 Agu 2026 (20 Agu 2026 Rp 5.000.000).")).toBeVisible();

  await page.goto(`/clients/${id}/close?period=2026-08`);
  await expect(page.getByTestId("control-masa")).toContainText("Pajak masa disetor");
  await expect(page.getByTestId("control-masa")).toContainText("Perlu dicek");

  await page.goto(`/clients/${id}/tax/masa?period=2026-08`);
  await page.getByRole("button", { name: "Hapus angsuran mulai masa April 2026" }).click();
  await expect(page.getByText("Angsuran PPh 25 dihapus")).toBeVisible();
  await expect(page.getByTestId("masa-row-PPH_25")).toContainText("Juli 2026 · Disetor");
});
