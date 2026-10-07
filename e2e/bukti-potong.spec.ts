import { expect, test } from "@playwright/test";
import { addClient, uploadStatement } from "./qa-helpers";

/**
 * Bukti potong Unifikasi (I5d): a consultant paid net of PPh 23 (booked in Review with the hint's one click), then the Coretax list of
 * slips the company made: one for that payment and one with no withholding in the books. Pajak Masa explains it and Tutup Buku flags it.
 */
const CSV = ["Tanggal;Keterangan;Debet;Kredit;Saldo", "01/08/2026;SALDO AWAL;;;500.000.000,00", "21/08/2026;JASA KONSULTAN HARAPAN;14.700.000,00;0,00;485.300.000,00", ""].join("\n");
const SLIPS = [
  "Nomor Bukti Potong;Tanggal Pemotongan;Masa Pajak;Tahun Pajak;NPWP/NIK Penerima Penghasilan;Nama Penerima Penghasilan;Kode Objek Pajak;Dasar Pengenaan Pajak (Rp);PPh Dipotong (Rp);Status",
  "2600000123;21/08/2026;8;2026;0999;PT Konsultan Harapan;24-104-01;15000000;300000;NORMAL",
  "2600000125;28/08/2026;8;2026;0777;CV Lain;24-104-01;2500000;50000;NORMAL",
  "",
].join("\n");

test("Coretax bukti potong against the withholding in the books; Tutup Buku flags a slip with no withholding", async ({ page }) => {
  const id = await addClient(page, { name: "QA Bukti Potong" });
  await uploadStatement(page, id, "bupot.csv", CSV);
  await expect(page.getByTestId("import-result")).toContainText("Nyambung");
  await page.goto(`/clients/${id}/review?period=2026-08`);
  const item = page.getByTestId("review-item").filter({ hasText: "KONSULTAN" });
  await item.getByRole("combobox", { name: "Akun", exact: true }).click();
  await page.getByRole("combobox", { name: "Cari akun", expanded: true }).fill("6170");
  await page.keyboard.press("Enter");
  await item.getByRole("button", { name: "Potong PPh 23 2%" }).click();
  await item.getByTestId("accept").click();
  await expect(page.getByTestId("review-item").filter({ hasText: "KONSULTAN" })).toHaveCount(0);
  await expect(page.getByTestId("review-saving")).toHaveCount(0);

  await page.goto(`/clients/${id}/tax/masa?period=2026-08`);
  await page.getByLabel("File bukti potong Coretax").setInputFiles({ name: "bppu.csv", mimeType: "text/csv", buffer: Buffer.from(SLIPS) });
  await page.getByTestId("bupot-upload").click();
  await expect(page.getByText("Bukti potong dibuat: 2 baru, 0 berubah")).toBeVisible();
  const d = page.getByTestId("bupot-DIBUAT");
  await expect(d).toContainText("Perlu dicek");
  await expect(d).toContainText("1 bukti potong cocok dengan pemotongan di buku per nominal PPh.");
  await expect(d.getByTestId("bupot-unbooked-DIBUAT")).toContainText("2600000125");
  await expect(page.getByText("Bukti potong dibuat: PPh Rp 350.000 vs buku Rp 300.000; 1 bukti potong tanpa pemotongan di buku.")).toBeVisible();
  await expect(page.getByTestId("bupot-DITERIMA")).toContainText("Belum ada bukti potong diterima masa Agustus 2026 yang diunggah.");

  await page.goto(`/clients/${id}/close?period=2026-08`);
  await expect(page.getByTestId("control-bupot")).toContainText("Bukti potong Coretax = buku");
  await expect(page.getByTestId("control-bupot")).toContainText("Perlu dicek");
});
