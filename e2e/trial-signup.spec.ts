import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * A trial from the public form (ADR 0017 §4, cycle 2026-10-09-trial-tenants-roles T09): someone asks on /daftar, a Buku admin approves
 * it with an end date in Permintaan, the invitation arrives through the local mail capture, and the new owner sets a password and lands
 * in a workspace that says when the trial ends.
 */
test.use({ storageState: { cookies: [], origins: [] } });

async function inviteLink(request: APIRequestContext, email: string) {
  const mailUrl = process.env.LOCAL_MAIL_URL ?? "http://127.0.0.1:54324";
  if (!["localhost", "127.0.0.1"].includes(new URL(mailUrl).hostname)) throw new Error("Mail capture must be local.");
  let id = "";
  await expect.poll(async () => {
    const data = await (await request.get(`${mailUrl}/api/v1/messages`)).json() as { messages: { ID: string; Subject: string; To: { Address: string }[] }[] };
    id = data.messages.find((m) => m.Subject === "Undangan ke Buku" && m.To.some((to) => to.Address === email))?.ID ?? "";
    return id;
  }, { timeout: 20_000 }).not.toBe("");
  const html = (await (await request.get(`${mailUrl}/api/v1/message/${id}`)).json() as { HTML: string }).HTML;
  return { html, link: html.match(/href="([^"]*\/auth\/callback\?token_hash=[^"]+)"/)![1].replaceAll("&amp;", "&") };
}

test("a trial request on /daftar becomes an organisation, an invitation and a workspace", async ({ page, browser, baseURL, request }) => {
  const authUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!["localhost", "127.0.0.1"].includes(new URL(authUrl).hostname)) throw new Error("Signup tests require the local stack.");
  const email = `trial-${randomUUID()}@example.test`;
  const orgName = `Kantor Coba ${Date.now()}`;

  await page.goto("/login");
  await page.getByRole("link", { name: "Minta uji coba" }).first().click();
  await expect(page).toHaveURL(/\/daftar$/);
  const consent = page.locator("#signup-consent");
  await expect(consent).toContainText("memproses data");
  await expect(consent.getByRole("link", { name: "Syarat", exact: true })).toHaveAttribute("href", "/syarat");
  await expect(consent.getByRole("link", { name: "Privasi", exact: true })).toHaveAttribute("href", "/kebijakan-privasi");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/daftar-${width}.png`, fullPage: true });
  }
  await page.getByRole("button", { name: "Minta akses uji coba" }).click();
  await expect(page.getByTestId("signup-done")).toHaveCount(0);
  expect(await page.getByLabel("Nama Anda").evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
  await page.getByLabel("Nama Anda").fill("Rina Coba");
  await page.getByLabel("Email kerja").fill("alamat-tidak-valid");
  await page.getByLabel("Nama kantor").fill(orgName);
  await page.getByRole("button", { name: "Minta akses uji coba" }).click();
  expect(await page.getByLabel("Email kerja").evaluate((input: HTMLInputElement) => input.validity.typeMismatch)).toBe(true);
  await expect(page.getByLabel("Nama Anda")).toHaveValue("Rina Coba");
  await expect(page.getByLabel("Nama kantor")).toHaveValue(orgName);
  await expect(page.getByTestId("signup-done")).toHaveCount(0);
  await page.getByLabel("Email kerja").fill(email);
  await page.getByLabel("Nama Anda").fill(" ");
  await page.getByRole("button", { name: "Minta akses uji coba" }).click();
  await expect(page.getByRole("alert")).toHaveText("Tulis nama Anda.");
  await expect(page.getByRole("alert")).toBeFocused();
  await expect(page.getByLabel("Email kerja")).toHaveValue(email);
  await expect(page.getByLabel("Nama kantor")).toHaveValue(orgName);
  await page.getByLabel("Nama Anda").fill("Rina Coba");
  await page.getByRole("button", { name: "Minta akses uji coba" }).click();
  await expect(page.getByTestId("signup-done")).toContainText("Kami kirim email setelah akses uji coba disetujui");
  await expect(page.getByTestId("signup-done")).toBeFocused();
  await page.screenshot({ path: "test-results/daftar-terima-kasih-390.png", fullPage: true });
  await expect(page.locator("body")).not.toContainText(/supabase/i);

  const { email: opsEmail, password } = JSON.parse(readFileSync(".playwright/credentials-ops.json", "utf8")) as { email: string; password: string };
  const ops = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const backoffice = await ops.newPage();
  await backoffice.goto("/login");
  await backoffice.getByLabel("Email").fill(opsEmail);
  await backoffice.getByLabel("Kata sandi").fill(password);
  await backoffice.getByRole("button", { name: "Masuk", exact: true }).click();
  await backoffice.waitForURL(/\/backoffice$/, { timeout: 30_000 });
  await backoffice.getByRole("link", { name: "Permintaan" }).click();
  const row = backoffice.getByTestId("request-row").filter({ hasText: email });
  await expect(row).toContainText(orgName);
  for (const width of [1440, 390]) {
    await backoffice.setViewportSize({ width, height: 900 });
    expect(await backoffice.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await backoffice.screenshot({ path: `test-results/backoffice-requests-${width}.png`, fullPage: true });
  }
  await backoffice.setViewportSize({ width: 1440, height: 900 });
  const endsOn = new Date(Date.now() + 7 * 3600_000 + 5 * 86_400_000).toISOString().slice(0, 10);
  await row.getByLabel("Uji coba sampai").fill(endsOn);
  await row.getByRole("button", { name: "Setujui" }).click();
  await expect(backoffice.getByTestId("requests-decided")).toContainText(email);
  await backoffice.getByTestId("requests-decided").getByRole("link", { name: orgName }).click();
  await expect(backoffice.getByTestId("grants")).toContainText("Uji coba");
  await expect(backoffice.getByTestId("platform-events")).toContainText(`Permintaan ${email} disetujui`);
  await ops.close();

  const admin = createSupabaseAdmin();
  try {
    const { html, link } = await inviteLink(request, email);
    expect(html).toContain(orgName);
    expect(new URL(link).origin).toBe(new URL(baseURL!).origin);
    for (const path of ["/syarat", "/kebijakan-privasi"]) {
      expect(html).toContain(`href="${new URL(path, baseURL!).href}"`);
      const legal = await request.get(path);
      expect(legal.status()).toBe(200);
      expect(await legal.text()).toContain("Draf");
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(link);
    await page.getByRole("button", { name: "Lanjutkan", exact: true }).click();
    await expect(page).toHaveURL(/\/atur-sandi$/);
    await page.getByLabel("Kata sandi baru").fill("sandi-uji-coba-1");
    await page.getByLabel("Ulangi kata sandi").fill("sandi-uji-coba-1");
    await page.getByRole("button", { name: "Simpan dan masuk" }).click();
    await expect(page.getByRole("heading", { name: "Beranda", exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("access-banner")).toContainText("Uji coba berakhir dalam 5 hari");
    // The owner manages the team of their own new organisation.
    await page.goto("/settings?tab=tim");
    await expect(page.getByText("Pemilik").first()).toBeVisible();
  } finally {
    const users = await admin.auth.admin.listUsers({ perPage: 1000 });
    const id = users.data.users.find((u) => u.email === email)?.id;
    if (id) await admin.auth.admin.deleteUser(id);
  }
});
