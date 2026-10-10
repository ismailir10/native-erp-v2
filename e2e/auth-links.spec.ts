import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

test.use({ storageState: { cookies: [], origins: [] } });

/** Real local SMTP capture, not a generated link or an auth bypass. */
async function capturedMail(request: APIRequestContext, email: string, subject: string) {
  const mailUrl = process.env.LOCAL_MAIL_URL ?? "http://127.0.0.1:54324";
  if (!["localhost", "127.0.0.1"].includes(new URL(mailUrl).hostname)) throw new Error("Mail capture must be local.");
  let messageId = "";
  await expect.poll(async () => {
    const response = await request.get(`${mailUrl}/api/v1/messages`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json() as { messages: { ID: string; Subject: string; To: { Address: string }[] }[] };
    messageId = data.messages.find((mail) => mail.Subject === subject && mail.To.some((to) => to.Address === email))?.ID ?? "";
    return messageId;
  }, { timeout: 20_000 }).not.toBe("");
  const message = await request.get(`${mailUrl}/api/v1/message/${messageId}`);
  return (await message.json() as { HTML: string }).HTML;
}

function callbackLink(html: string) {
  const link = html.match(/href="([^"]*\/auth\/callback\?token_hash=[^"]+)"/)?.[1];
  expect(link).toBeTruthy();
  return link!.replaceAll("&amp;", "&");
}

async function emailScreenshots(page: Page, html: string, name: string) {
  // Screenshots keep the layout and show an inert example URL, never a usable login token.
  const inert = html.replace(/token_hash=[^&"<\s]+/g, "token_hash=contoh-tautan");
  for (const width of [375, 1000]) {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(inert);
    await expect(page.getByRole("heading")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/auth-${name}-${width}.png`, fullPage: true });
  }
}

async function openLegalLinks(page: Page, html: string, origin: string) {
  for (const [path, title] of [["/syarat", "Syarat penggunaan"], ["/kebijakan-privasi", "Kebijakan privasi"]]) {
    const url = new URL(path, origin).href;
    expect(html).toContain(`href="${url}"`);
    await page.goto(url);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole("note")).toContainText("Draf");
  }
}

test("captured invite and recovery stay on Buku; scanners cannot consume them, POST sets the session, replay expires", async ({ page, browser, request, baseURL }) => {
  const authUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!["localhost", "127.0.0.1"].includes(new URL(authUrl).hostname)) throw new Error("Auth link tests require the local stack.");
  const admin = createSupabaseAdmin();
  const email = `auth-link-${randomUUID()}@example.test`;
  const invited = await admin.auth.admin.inviteUserByEmail(email, { data: { name: "Pemilik Uji", org_name: "PT Contoh Uji", org_kind: "PERUSAHAAN", access_until: "24 Okt 2026" } });
  expect(invited.error).toBeNull();
  const id = invited.data.user!.id;
  try {
    const html = await capturedMail(request, email, "Undangan ke Buku");
    expect(html).toContain("PT Contoh Uji");
    expect(html).toContain("24 Okt 2026");
    expect(html).not.toMatch(/supabase|ConfirmationURL/i);
    const inviteUrl = callbackLink(html);
    expect(new URL(inviteUrl).origin).toBe(new URL(baseURL!).origin);
    await emailScreenshots(page, html, "invite");
    await openLegalLinks(page, html, baseURL!);

    const before = (await admin.auth.admin.getUserById(id)).data.user?.email_confirmed_at;
    expect(before).toBeFalsy();
    for (let i = 0; i < 2; i++) {
      const scanner = await request.get(inviteUrl);
      expect(scanner.status()).toBe(200);
      expect(await scanner.text()).toContain("Lanjutkan");
    }
    expect((await admin.auth.admin.getUserById(id)).data.user?.email_confirmed_at).toBeFalsy();
    await page.goto(inviteUrl);
    await expect(page.getByRole("button", { name: "Lanjutkan", exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "test-results/auth-confirm-390.png" });
    await page.getByRole("button", { name: "Lanjutkan", exact: true }).click();
    await expect(page).toHaveURL(/\/atur-sandi$/);
    await expect(page.getByRole("button", { name: "Simpan dan masuk" })).toBeEnabled();
    expect((await admin.auth.admin.getUserById(id)).data.user?.email_confirmed_at).toBeTruthy();

    const replay = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const replayPage = await replay.newPage();
    await replayPage.goto(inviteUrl);
    await replayPage.getByRole("button", { name: "Lanjutkan", exact: true }).click();
    await expect(replayPage.getByText("Tautan sudah kedaluwarsa atau sudah dipakai.", { exact: false })).toBeVisible();
    await expect(replayPage.getByRole("button", { name: "Kirim tautan baru" })).toBeVisible();
    await replay.close();

    expect((await admin.auth.resetPasswordForEmail(email)).error).toBeNull();
    const recovery = await capturedMail(request, email, "Atur ulang kata sandi Buku");
    expect(new URL(callbackLink(recovery)).origin).toBe(new URL(baseURL!).origin);
    await emailScreenshots(page, recovery, "recovery");
    await openLegalLinks(page, recovery, baseURL!);
    await page.goto(callbackLink(recovery));
    await page.getByRole("button", { name: "Lanjutkan", exact: true }).click();
    await expect(page.getByRole("button", { name: "Simpan dan masuk" })).toBeEnabled();
  } finally {
    await admin.auth.admin.deleteUser(id);
  }
});

/**
 * The auth server's default template (cycle 2026-10-10-auth-callback-fragment): the link verifies on the auth server and comes back
 * to /auth/callback with the session in the fragment. It must reach the password page, not "Tautan tidak berlaku".
 */
test("default-template invite and reset links reach the password page; a failed one says so", async ({ page, baseURL }) => {
  const authUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!["localhost", "127.0.0.1"].includes(new URL(authUrl).hostname)) throw new Error("Auth link tests require the local stack.");
  const admin = createSupabaseAdmin();
  const email = `default-link-${randomUUID()}@example.test`;
  const redirectTo = `${baseURL}/auth/callback`;
  const invite = await admin.auth.admin.generateLink({ type: "invite", email, options: { redirectTo } });
  expect(invite.error).toBeNull();
  const id = invite.data.user!.id;
  try {
    await page.goto(invite.data.properties!.action_link);
    await page.waitForURL(/\/atur-sandi$/);
    await expect(page.getByText("Tautan tidak berlaku")).toHaveCount(0);
    await page.getByLabel("Kata sandi baru").fill("sandi-bawaan-1");
    await page.getByLabel("Ulangi kata sandi").fill("sandi-bawaan-1");
    await expect(page.getByRole("button", { name: "Simpan dan masuk" })).toBeEnabled();
    await page.getByRole("button", { name: "Simpan dan masuk" }).click();
    // No membership for this address: the password is saved and the app sends them on (login or closed); never back to the link page.
    await page.waitForURL((url) => !url.pathname.startsWith("/atur-sandi") && !url.pathname.startsWith("/auth/callback"));
    expect((await admin.auth.admin.getUserById(id)).data.user?.email_confirmed_at).toBeTruthy();

    await page.context().clearCookies();
    const reset = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
    expect(reset.error).toBeNull();
    await page.goto(reset.data.properties!.action_link);
    await page.waitForURL(/\/atur-sandi$/);
    await expect(page.getByRole("button", { name: "Simpan dan masuk" })).toBeEnabled();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "test-results/auth-default-link-390.png" });

    // A spent default-template link comes back with the failure in the fragment.
    await page.goto("/auth/callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
    await expect(page.getByRole("heading", { name: "Tautan tidak berlaku" })).toBeVisible();
    await expect(page.getByText("Tautan sudah kedaluwarsa.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Kirim tautan baru" })).toBeVisible();
  } finally {
    await admin.auth.admin.deleteUser(id);
  }
});
