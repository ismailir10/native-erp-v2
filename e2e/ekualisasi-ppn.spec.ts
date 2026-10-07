import { expect, test, type Locator, type Page } from "@playwright/test";
import { addClient, uploadStatement } from "./qa-helpers";

/**
 * Ekualisasi PPN (I5c): two receipts booked with PPN keluaran, a Coretax keluaran export with one faktur for the first receipt, one faktur
 * not in the books and one cancelled faktur. Pajak Masa explains the difference both ways, and Tutup Buku flags it.
 */
const CSV = [
  "Tanggal;Keterangan;Debet;Kredit;Saldo",
  "01/08/2026;SALDO AWAL;;;500.000.000,00",
  "05/08/2026;TRSF CR PT MITRA ALFA;0,00;111.000.000,00;611.000.000,00",
  "12/08/2026;TRSF CR CV BETA BARU;0,00;33.300.000,00;644.300.000,00",
  "",
].join("\n");
const FAKTUR = [
  "Nomor Faktur Pajak;Tanggal Faktur Pajak;Masa Pajak;Tahun;NPWP Pembeli;Nama Pembeli;Status Faktur;Harga Jual/Penggantian/DPP;PPN",
  "04002600000000001;05/08/2026;8;2026;0111;PT Mitra Alfa;APPROVED;100000000;11000000",
  "04002600000000002;20/08/2026;8;2026;0222;CV Gamma;APPROVED;20000000;2200000",
  "04002600000000003;21/08/2026;8;2026;0222;CV Gamma;CANCELLED;50000000;5500000",
  "",
].join("\n");

async function revenueWithPpn(page: Page, item: Locator) {
  await item.getByRole("combobox", { name: "Akun", exact: true }).click();
  await page.getByRole("combobox", { name: "Cari akun", expanded: true }).fill("4100");
  await page.keyboard.press("Enter");
  await item.getByRole("combobox", { name: "Pajak", exact: true }).click();
  await page.getByRole("option", { name: /PPN Keluaran/ }).first().click();
  await item.getByTestId("accept").click();
}

test("Coretax faktur keluaran against the books: matched, not booked, booked without a faktur, cancelled; Tutup Buku flags it", async ({ page }) => {
  const id = await addClient(page, { name: "QA Ekualisasi" });
  await uploadStatement(page, id, "ekualisasi.csv", CSV);
  await expect(page.getByTestId("import-result")).toContainText("Nyambung");
  await page.goto(`/clients/${id}/review?period=2026-08`);
  const items = page.getByTestId("review-item");
  for (const who of ["MITRA ALFA", "BETA BARU"]) {
    await revenueWithPpn(page, items.filter({ hasText: who }));
    await expect(items.filter({ hasText: who })).toHaveCount(0);
  }
  await expect(page.getByTestId("review-saving")).toHaveCount(0);

  await page.goto(`/clients/${id}/tax/masa?period=2026-08`);
  await expect(page.getByTestId("faktur-KELUARAN")).toContainText("Belum ada faktur keluaran masa Agustus 2026 yang diunggah.");
  await page.getByLabel("File faktur Coretax").setInputFiles({ name: "faktur-keluaran.csv", mimeType: "text/csv", buffer: Buffer.from(FAKTUR) });
  await page.getByTestId("faktur-upload").click();
  await expect(page.getByText("Faktur keluaran: 3 baru, 0 berubah")).toBeVisible();

  const k = page.getByTestId("faktur-KELUARAN");
  await expect(k).toContainText("Perlu dicek");
  await expect(k).toContainText("1 faktur cocok dengan buku per nominal PPN. 1 faktur batal, diganti atau ditolak tidak dihitung.");
  await expect(k.getByTestId("faktur-unbooked-KELUARAN")).toContainText("04002600000000002");
  await expect(k.getByTestId("faktur-unfaktured-KELUARAN")).toContainText("TRSF CR CV BETA BARU");
  await expect(k.getByTestId("faktur-unfaktured-KELUARAN")).toContainText("3.300.000");
  await expect(page.getByText("Faktur keluaran: PPN faktur Rp 13.200.000 vs buku Rp 14.300.000 (selisih Rp 1.100.000); 1 faktur belum ada di buku, 1 PPN di buku tanpa faktur.")).toBeVisible();

  // The faktur not in the books is a sale not yet paid: one click books it as a receivable, and only the unfakturised receipt remains.
  await k.getByTestId("faktur-unbooked-KELUARAN").getByRole("button", { name: "Catat piutang" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Catat faktur 04002600000000002 sebagai piutang?");
  await expect(dialog.getByRole("combobox", { name: "Akun pendapatan" })).toContainText("4100");
  await dialog.getByRole("button", { name: "Catat piutang" }).click();
  await expect(page.getByText("Faktur 04002600000000002 dicatat sebagai piutang")).toBeVisible();
  await expect(k.getByTestId("faktur-unbooked-KELUARAN")).toHaveCount(0);
  await expect(page.getByText("Faktur keluaran: PPN faktur Rp 13.200.000 vs buku Rp 16.500.000 (selisih Rp 3.300.000); 1 PPN di buku tanpa faktur.")).toBeVisible();
  await page.goto(`/clients/${id}/receivables?period=2026-08`);
  await expect(page.getByText("04002600000000002").first()).toBeVisible();

  await page.goto(`/clients/${id}/close?period=2026-08`);
  await expect(page.getByTestId("control-faktur")).toContainText("Faktur Coretax = buku");
  await expect(page.getByTestId("control-faktur")).toContainText("Perlu dicek");

  // Removing the masa's keluaran faktur leaves nothing to compare and the control goes.
  await page.goto(`/clients/${id}/tax/masa?period=2026-08`);
  if (process.env.E2E_SCREENSHOTS) {
    await page.locator("#ekualisasi").screenshot({ path: `${process.env.E2E_SCREENSHOTS}/ekualisasi-1440.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#ekualisasi").screenshot({ path: `${process.env.E2E_SCREENSHOTS}/ekualisasi-390.png` });
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await k.getByRole("button", { name: "Hapus faktur keluaran masa ini" }).click();
  await page.getByRole("button", { name: "Hapus faktur" }).click();
  await expect(page.getByText("3 faktur dihapus")).toBeVisible();
  await expect(page.getByTestId("faktur-KELUARAN")).toContainText("Belum ada faktur keluaran");
});
