import { expect, test } from "@playwright/test";

/** Moving between clients: the page is kept, every client page names its client, a drill page has a way up. Runs at desktop and 390px. */

async function openClient(page: import("@playwright/test").Page, name: string) {
  await page.goto("/");
  const list = page.getByRole("button", { name: /^Daftar klien \(\d+\)$/ });
  if ((await list.getAttribute("aria-expanded")) !== "true") await list.click();
  // The sidebar comes first in the page; Beranda lists clients again further down.
  await page.getByRole("link", { name, exact: true }).first().click();
  await expect(page.getByTestId("client-bar")).toContainText(name);
}

test("switching client keeps the page and the period, by keyboard", async ({ page }) => {
  await openClient(page, "Grup Ayam Nusantara");
  await page.goto(page.url().replace(/\/clients\/([^/?]+).*/, "/clients/$1/trial-balance?period=2026-07"));
  await expect(page.getByRole("heading", { name: "Neraca Saldo", exact: true })).toBeVisible();

  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox")).toBeFocused();
  // Every client row says where it will land.
  await expect(dialog.getByRole("option", { name: /CV Sinar Retail.*Neraca Saldo/ })).toBeVisible();
  await expect(dialog.getByRole("option", { name: /Grup Ayam Nusantara.*Sekarang/ })).toBeVisible();
  await page.keyboard.type("sinar");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/clients\/[^/]+\/trial-balance\?.*period=2026-07/);
  await expect(page.getByRole("heading", { name: "Neraca Saldo", exact: true })).toBeVisible();
  await expect(page.getByTestId("client-bar")).toContainText("CV Sinar Retail");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The sidebar follows (desktop only: it is a sheet on a phone).
  if ((page.viewportSize()?.width ?? 0) >= 768) await expect(page.getByTestId("client-switcher")).toContainText("CV Sinar Retail");
});

test("a company name finds its client, and a page of the open client opens from the same palette", async ({ page }) => {
  await openClient(page, "CV Sinar Retail");
  await page.getByTestId("client-bar").getByRole("button").click();
  await page.keyboard.type("budi");
  await expect(page.getByRole("option", { name: /Grup Ayam Nusantara/ })).toBeVisible();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("nonsense-zzz");
  await expect(page.getByText("Tidak ada klien atau halaman")).toBeVisible();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("buku besar");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/clients\/[^/]+\/ledger\?/);
});

test("a drill page names the way up, and a page never repeats its own section in the bar", async ({ page }) => {
  await openClient(page, "Grup Ayam Nusantara");
  await page.goto(page.url().replace(/\/clients\/([^/?]+).*/, "/clients/$1/ledger?period=2026-07"));
  const bar = page.getByTestId("client-bar");
  await expect(page.getByRole("heading", { name: "Buku Besar", exact: true })).toBeVisible();
  await expect(bar.getByRole("link", { name: "Buku Besar" })).toHaveCount(0);
  await page.getByRole("link", { name: /^1101 / }).first().click();
  await expect(page.getByRole("heading", { name: /^1101 / })).toBeVisible();
  await bar.getByRole("link", { name: "Buku Besar" }).click();
  await expect(page).toHaveURL(/\/ledger\?.*period=2026-07/);
  await expect(page.getByRole("heading", { name: "Buku Besar", exact: true })).toBeVisible();
});

test("from Beranda the palette opens a client's Ringkasan; the sidebar names each scope", async ({ page }) => {
  await page.goto("/?scope=all");
  await expect(page.getByRole("heading", { name: "Beranda", exact: true })).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.keyboard.type("jasa");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("client-bar")).toContainText("PT Jasa Kreatif Digital");
  await expect(page).toHaveURL(/\/clients\/[^/?]+\?/);
  if ((page.viewportSize()?.width ?? 0) >= 768) {
    const side = page.locator("[data-slot=sidebar]").first();
    await expect(side.getByText("Semua klien", { exact: true })).toBeVisible();
    await expect(side.getByRole("link", { name: "Pengaturan kantor" })).toBeVisible();
    await expect(side.getByRole("link", { name: "Ringkasan klien" })).toHaveAttribute("aria-current", "page");
  }
});

test.describe("at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("the bar is the way to change client when the sidebar is closed", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Buka navigasi" }).click();
    await page.getByRole("link", { name: "Grup Ayam Nusantara", exact: true }).click();
    const bar = page.getByTestId("client-bar");
    await expect(bar).toContainText("Grup Ayam Nusantara");
    await bar.getByRole("button").click();
    await page.getByRole("option", { name: /CV Sinar Retail/ }).click();
    await expect(bar).toContainText("CV Sinar Retail");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
