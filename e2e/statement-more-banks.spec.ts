import { expect, test } from "@playwright/test";

/**
 * A client at a bank outside the big four: pick it in the searchable bank field, see which banks Buku reads, import an MT940 file
 * that names another bank (CIMB Niaga by its BIC) and record the account at the file's bank with one click. Runs after the investor
 * walk (files run alphabetically); August 2026 rows only, so the firm's work period doesn't move. The file is synthetic.
 */
const lines = [
  "{1:F01BNIAIDJAAXXX0000000000}{2:O9401200260901BNIAIDJAXXXX00000000002609011200N}{4:",
  ":20:STMT260831",
  ":25:800123456789",
  ":28C:00001/001",
  ":60F:C260731IDR50000000,00",
  ":61:2608050805C12500000,00NTRFNONREF//FT2605",
  ":86:TRSF MASUK CV SUMBER REJEKI",
  ":61:2608200820D15000,00NMSCNONREF",
  ":86:BIAYA ADMINISTRASI",
  ":62F:C260831IDR62485000,00",
  "-}",
];

test("pick a bank, import an MT940 from another bank, record the account at the file's bank", async ({ page }) => {
  await page.goto("/");
  const clientList = page.getByRole("button", { name: /^Daftar klien \(\d+\)$/ });
  if ((await clientList.getAttribute("aria-expanded")) !== "true") await clientList.click();
  await page.getByRole("link", { name: "Tambah klien" }).click();
  await page.getByLabel("Nama klien").fill("Bank Lain Uji");
  await page.getByLabel("Nama lengkap").fill("PT Bank Lain Uji");
  await page.getByLabel("Nama singkat").fill("PT BLU");
  // The bank field searches 25 banks; the account is recorded at BNI (wrongly, as the file will show).
  await page.getByRole("combobox", { name: "Bank", exact: true }).click();
  await page.getByLabel("Cari bank").fill("bni");
  await page.getByRole("option", { name: "BNI", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Bank", exact: true })).toContainText("BNI");
  await page.getByLabel("Nomor rekening").fill("800123456789");
  await page.getByLabel("Nama rekening").fill("Giro Operasional");
  await page.getByRole("button", { name: "Simpan klien" }).click();

  await expect(page.getByRole("heading", { name: "Impor Mutasi" })).toBeVisible();
  await page.getByRole("button", { name: "Lihat 25 bank" }).click();
  await expect(page.getByTestId("bank-list")).toContainText("SeaBank");
  await expect(page.getByTestId("bank-list")).toContainText("Bank Jago");

  await page.getByTestId("file-input").setInputFiles({ name: "cimb-agustus.mt940", mimeType: "text/plain", buffer: Buffer.from(lines.join("\r\n")) });
  await page.getByRole("button", { name: "Proses mutasi" }).click();
  const result = page.getByTestId("import-result");
  await expect(result).toContainText("Nyambung");
  await expect(result).toContainText("CIMB Niaga");
  await expect(result).toContainText("Dibaca sebagai MT940");
  await page.screenshot({ path: "test-results/more-banks-1440.png", fullPage: true });

  const differs = page.getByTestId("bank-differs");
  await expect(differs).toContainText("File ini dari CIMB Niaga, rekening Giro Operasional tercatat di BNI.");
  await differs.getByRole("button", { name: "Catat rekening ini sebagai CIMB Niaga" }).click();
  await expect(page.getByText("Rekening dicatat di CIMB Niaga")).toBeVisible();
  await expect(differs).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/more-banks-390.png", fullPage: true });
});
