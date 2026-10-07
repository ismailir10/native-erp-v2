import { expect, test, type Locator, type Page } from "@playwright/test";
import { addClient, uploadStatement } from "./qa-helpers";

/**
 * Kompensasi PPN: a receipt with PPN keluaran and a purchase with PPN masukan in August. Pajak Masa asks for the masa-end compensation
 * journal, one click posts it (Dr 2130 / Cr 1150), and the ledger of 1150 shows it.
 */
const CSV = [
  "Tanggal;Keterangan;Debet;Kredit;Saldo",
  "01/08/2026;SALDO AWAL;;;500.000.000,00",
  "05/08/2026;TRSF CR PT MITRA ALFA;0,00;111.000.000,00;611.000.000,00",
  "12/08/2026;TRSF DB PT PAKAN JAYA;55.500.000,00;0,00;555.500.000,00",
  "",
].join("\n");

async function book(page: Page, item: Locator, code: string, tax: RegExp) {
  await item.getByRole("combobox", { name: "Akun", exact: true }).click();
  await page.getByRole("combobox", { name: "Cari akun", expanded: true }).fill(code);
  await page.keyboard.press("Enter");
  await item.getByRole("combobox", { name: "Pajak", exact: true }).click();
  await page.getByRole("option", { name: tax }).first().click();
  await item.getByTestId("accept").click();
}

test("Pajak Masa asks for the PPN compensation journal and posts it with one click", async ({ page }) => {
  const id = await addClient(page, { name: "QA Kompensasi PPN" });
  await uploadStatement(page, id, "kompensasi.csv", CSV);
  await expect(page.getByTestId("import-result")).toContainText("Nyambung");
  await page.goto(`/clients/${id}/review?period=2026-08`);
  const items = page.getByTestId("review-item");
  await book(page, items.filter({ hasText: "MITRA ALFA" }), "4100", /PPN Keluaran/);
  await expect(items.filter({ hasText: "MITRA ALFA" })).toHaveCount(0);
  await book(page, items.filter({ hasText: "PAKAN JAYA" }), "5100", /PPN Masukan/);
  await expect(items.filter({ hasText: "PAKAN JAYA" })).toHaveCount(0);
  await expect(page.getByTestId("review-saving")).toHaveCount(0);

  await page.goto(`/clients/${id}/tax/masa?period=2026-08`);
  await expect(page.getByText("Catat jurnal kompensasi PPN masa Agustus 2026")).toBeVisible();
  const offset = page.getByTestId("ppn-offset");
  await expect(offset).toContainText("PPN masukan belum dikompensasikan ke keluaran: Rp 5.500.000");
  await expect(offset).toContainText("Dr 2130 PPN Keluaran / Cr 1150 PPN Masukan per 31 Agu 2026");
  await offset.getByRole("button", { name: "Catat kompensasi" }).click();
  await expect(page.getByText("Jurnal kompensasi PPN dicatat")).toBeVisible();
  await expect(page.getByTestId("ppn-offset")).toHaveCount(0);
  // The masa's figures are unchanged: keluaran 11 jt, masukan 5,5 jt, owed 5,5 jt.
  await expect(page.getByTestId("masa-row-PPN")).toContainText("5.500.000");

  await page.goto(`/clients/${id}/ledger/1150?period=2026-08`);
  await expect(page.getByText("Kompensasi PPN masukan ke PPN keluaran masa Agustus 2026").first()).toBeVisible();
});
