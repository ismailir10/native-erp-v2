import { expect, test } from "@playwright/test";
import { makePdf, table } from "../tests/pdf-fixture";

/**
 * First real client, end to end: Tambah klien → Saldo Awal → password-protected PDF e-statement → bank reconciles.
 * Runs after the investor walk (files run alphabetically, one worker). The PDF is synthetic.
 */
const pdf = makePdf(
  [
    [
      ...table(800, [[[40, "PT Bank Mandiri (Persero) Tbk"]], [[40, "Nomor Rekening : 1400012345678"]], [[40, "Periode : 01/08/2026 - 31/08/2026"]]]),
      ...table(740, [
        [[40, "Tanggal"], [130, "Keterangan"], [360, "Debit"], [440, "Kredit"], [520, "Saldo"]],
        [[40, "01/08/2026"], [130, "SALDO AWAL"], [500, "80.000.000,00"]],
        [[40, "05/08/2026"], [130, "TRANSFER DARI CV SUMBER REJEKI"], [430, "12.500.000,00"], [510, "92.500.000,00"]],
        [[40, "20/08/2026"], [130, "BIAYA ADMINISTRASI"], [362, "15.000,00"], [510, "92.485.000,00"]],
      ]),
    ],
  ],
  { userPassword: "17081945" },
);

test("add a client, set opening balance, import a locked PDF, bank reconciles", async ({ page }) => {
  await page.goto("/");
  await page.getByText(/^Daftar klien \(\d+\)$/).click();
  await page.getByRole("link", { name: "Tambah klien" }).click();
  await page.getByLabel("Nama klien").fill("Toko Uji Coba");
  await page.getByLabel("Nama lengkap").fill("PT Toko Uji Coba");
  await page.getByLabel("Nama singkat").fill("PT Toko");
  await page.getByRole("combobox", { name: "Bank" }).click();
  await page.getByRole("option", { name: "Mandiri" }).click();
  await page.getByLabel("Nomor rekening").fill("1400012345678");
  await page.getByLabel("Nama rekening").fill("Mandiri Giro");
  await page.getByRole("button", { name: "Simpan klien" }).click();

  // Import first so Saldo Awal can prefill from the statement.
  await expect(page.getByRole("heading", { name: "Saldo Awal" })).toBeVisible();
  await page.getByRole("link", { name: "Impor Mutasi" }).click();
  await page.getByTestId("file-input").setInputFiles({ name: "mandiri-agustus.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.getByRole("button", { name: "Proses mutasi" }).click();
  await expect(page.getByLabel("Kata sandi PDF")).toBeVisible();
  await page.getByLabel("Kata sandi PDF").fill("17081945");
  await page.getByRole("button", { name: "Proses mutasi" }).click();
  const result = page.getByTestId("import-result");
  await expect(result).toContainText("Nyambung");

  await page.getByRole("link", { name: "Saldo Awal" }).click();
  await expect(page.getByLabel(/^Saldo Mandiri Giro/)).toHaveValue("80.000.000");
  await page.getByRole("button", { name: "Simpan saldo awal" }).click();
  await expect(page.getByText("Saldo awal semua entitas sudah dicatat.")).toBeVisible();

  await page.getByRole("link", { name: "Tutup Buku" }).click();
  const recon = page.getByTestId("control-bank").filter({ hasText: "Rekonsiliasi Mandiri Giro" });
  await expect(recon).toContainText("Lolos");
});
