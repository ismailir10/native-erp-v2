import { expect, test, type Page } from "@playwright/test";

/** An accepted bank line can move to another account from its ledger drawer (reviewer's writer, RECLASS); a closed month refuses. */
async function clientBase(page: Page, name: string) {
  await page.goto("/");
  await page.getByRole("link", { name, exact: true }).first().click();
  await expect(page).toHaveURL(/\/clients\/[^/?]+/);
  return new URL(page.url()).pathname.match(/\/clients\/[^/]+/)![0];
}

async function moveTo(page: Page, code: string) {
  const reclass = page.getByTestId("reclass");
  await reclass.getByRole("combobox", { name: "Akun baru", exact: true }).click();
  await page.getByRole("combobox", { name: "Cari akun baru" }).fill(code);
  await page.getByRole("option", { name: new RegExp(`^${code} `) }).click();
  await reclass.getByRole("button", { name: "Simpan", exact: true }).click();
}

test("Ubah akun in the ledger drawer reclassifies; a locked month says so", async ({ page }) => {
  const base = await clientBase(page, "CV Sinar Retail");
  await page.goto(`${base}/ledger/6130?period=2026-08`);
  await page.getByTestId("ledger-row").filter({ hasText: "PLN" }).click();
  await moveTo(page, "6190");
  await expect(page.getByText("Dipindah ke 6190")).toBeVisible();
  // The bank side never changes: 6130 keeps the original line and gets the reversing RECLASS; 6190 gets the difference.
  await expect(page.getByTestId("ledger-row").filter({ hasText: "PLN" })).toHaveCount(2);
  await page.goto(`${base}/ledger/6190?period=2026-08`);
  await expect(page.getByTestId("ledger-row").filter({ hasText: "Reklasifikasi" }).filter({ hasText: "PLN" })).toHaveCount(1);

  // July is closed: the same action is refused with the lock message.
  await page.goto(`${base}/ledger/6130?period=2026-07`);
  await page.getByTestId("ledger-row").first().click();
  await moveTo(page, "6190");
  await expect(page.getByText("Periode Juli 2026 sudah ditutup")).toBeVisible();
});
