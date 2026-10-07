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

test("a customer's withholding with no slip in the imported diterima list goes into the request to the client", async ({ page }) => {
  const id = await addClient(page, { name: "QA Bukti Diterima" });
  const csv = ["Tanggal;Keterangan;Debet;Kredit;Saldo", "01/08/2026;SALDO AWAL;;;100.000.000,00", "05/08/2026;TRSF CR PT BANK DIGITAL NUSA;0,00;53.900.000,00;153.900.000,00", ""].join("\n");
  await uploadStatement(page, id, "diterima.csv", csv);
  await expect(page.getByTestId("import-result")).toContainText("Nyambung");
  await page.goto(`/clients/${id}/review?period=2026-08`);
  const item = page.getByTestId("review-item").filter({ hasText: "BANK DIGITAL" });
  await item.getByRole("combobox", { name: "Akun", exact: true }).click();
  await page.getByRole("combobox", { name: "Cari akun", expanded: true }).fill("4110");
  await page.keyboard.press("Enter");
  await item.getByRole("combobox", { name: "Pemotongan PPh", exact: true }).click();
  await page.getByRole("option", { name: /PPh 23/ }).first().click();
  await item.getByTestId("accept").click();
  await expect(page.getByTestId("review-item").filter({ hasText: "BANK DIGITAL" })).toHaveCount(0);
  await expect(page.getByTestId("review-saving")).toHaveCount(0);

  // Coretax's diterima list holds another customer's slip only: the bank's is still owed.
  const list = ["Nomor Bukti Potong;Tanggal Bukti Potong;NPWP Pemotong;Nama Pemotong;Kode Objek Pajak;Penghasilan Bruto;PPh", "BP-90;10/08/2026;0222;PT Lain;24-104-01;10000000;200000", ""].join("\n");
  await page.goto(`/clients/${id}/tax/masa?period=2026-08`);
  await page.getByLabel("File bukti potong Coretax").setInputFiles({ name: "diterima.csv", mimeType: "text/csv", buffer: Buffer.from(list) });
  await page.getByTestId("bupot-upload").click();
  await expect(page.getByText("Bukti potong diterima: 1 baru, 0 berubah")).toBeVisible();
  await expect(page.getByTestId("bupot-noslip-DITERIMA")).toContainText("TRSF CR PT BANK DIGITAL NUSA");

  await page.goto(`/clients/${id}/import?period=2026-08`);
  await expect(page.getByTestId("data-request").getByLabel("Pesan permintaan data")).toHaveValue(/mohon mintakan bukti potong dari pelanggan untuk penerimaan berikut \(dipakai sebagai kredit pajak\):\n- 5 Agu 2026 · .+ · TRSF CR PT BANK DIGITAL NUSA · PPh 23 Rp 1\.100\.000/);
});
