import { expect, test, type Locator, type Page } from "@playwright/test";
import { addClient, uploadStatement } from "./qa-helpers";

/**
 * Indonesian tax mechanics in Review, with figures computed independently by the end-to-end QA run (docs/qa, cases G1–G5):
 *  - Rp 185.000.000 paid, PPN masukan 11 % effective (12 % × DPP nilai lain 11/12) → DPP 166.666.667 (1210) + PPN 18.333.333 (1150)
 *  - Rp 15.000.000 paid net of PPh 23 2 % with PPN: DPP = net ÷ 1,09 → 13.761.468 + PPN 1.513.761 − PPh 275.229 (2141) = net
 *  - Rp 60.000.000 received net of PPh 23 withheld by the customer, PPN keluaran: DPP 55.045.871 (4100) + PPN 6.055.046 (2130) − PPh 1.100.917 (1180)
 * and the books still balance (Neraca Saldo, Neraca).
 */
const CSV = [
  "Tanggal;Keterangan;Debet;Kredit;Saldo",
  "01/08/2026;SALDO AWAL;;;1.000.000.000,00",
  "19/08/2026;PEMBELIAN MESIN XYZ;185.000.000,00;0,00;815.000.000,00",
  "21/08/2026;JASA KONSULTAN ABC;15.000.000,00;0,00;800.000.000,00",
  "22/08/2026;PENERIMAAN DP KLIEN QQ;0,00;60.000.000,00;860.000.000,00",
  "",
].join("\n");

async function classify(page: Page, item: Locator, v: { account: string; tax?: RegExp; withholding?: RegExp }) {
  await item.getByRole("combobox", { name: "Akun", exact: true }).click();
  await page.getByRole("combobox", { name: "Cari akun" }).fill(v.account);
  await page.keyboard.press("Enter");
  if (v.tax) {
    await item.getByRole("combobox", { name: "Pajak", exact: true }).click();
    await page.getByRole("option", { name: v.tax }).first().click();
  }
  if (v.withholding) {
    await item.getByRole("combobox", { name: "Pemotongan PPh", exact: true }).click();
    await page.getByRole("option", { name: v.withholding }).first().click();
  }
  await item.getByTestId("accept").click();
}

const ledger = async (page: Page, id: string, code: string) => {
  await page.goto(`/clients/${id}/ledger/${code}?period=2026-08`);
  return page.locator("main");
};

test("PPN 11 % split and PPh 23 gross-up post the exact amounts, and the books balance", async ({ page }) => {
  const id = await addClient(page, { name: "QA Pajak" });
  await uploadStatement(page, id, "pajak.csv", CSV);
  await expect(page.getByTestId("import-result")).toContainText("Nyambung");

  await page.goto(`/clients/${id}/review?period=2026-08`);
  const items = page.getByTestId("review-item");
  await expect(items).toHaveCount(3);
  await classify(page, items.filter({ hasText: "MESIN XYZ" }), { account: "1210", tax: /PPN Masukan/ });
  await expect(items).toHaveCount(2);
  await classify(page, items.filter({ hasText: "KONSULTAN ABC" }), { account: "6170", tax: /PPN Masukan/, withholding: /PPh 23/ });
  await expect(items).toHaveCount(1);
  await classify(page, items.filter({ hasText: "DP KLIEN" }), { account: "4100", tax: /PPN Keluaran/, withholding: /PPh 23/ });
  await expect(page.getByText("Antrean kosong")).toBeVisible();

  await expect(await ledger(page, id, "1210")).toContainText("166.666.667");
  const ppnMasukan = await ledger(page, id, "1150");
  await expect(ppnMasukan).toContainText("18.333.333"); // 185.000.000 − 166.666.667
  await expect(ppnMasukan).toContainText("1.513.761"); // 15.000.000 ÷ 1,09 × 11 %
  await expect(await ledger(page, id, "6170")).toContainText("13.761.468");
  await expect(await ledger(page, id, "2141")).toContainText("275.229");
  await expect(await ledger(page, id, "4100")).toContainText("55.045.871");
  await expect(await ledger(page, id, "2130")).toContainText("6.055.046");
  await expect(await ledger(page, id, "1180")).toContainText("1.100.917");

  await page.goto(`/clients/${id}/trial-balance?period=2026-08`);
  await expect(page.getByText("Seimbang").first()).toBeVisible();
  await page.goto(`/clients/${id}/reports?tab=bs&period=2026-08`);
  await expect(page.getByText("Seimbang", { exact: true }).first()).toBeVisible();
});
