import { readdirSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readLinkToken } from "@/app/auth/callback/token";

const auth = vi.hoisted(() => ({ verifyOtp: vi.fn(), exchangeCodeForSession: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth }) }));
import { POST } from "@/app/auth/callback/confirm/route";

describe("Buku email templates", () => {
  const config = readFileSync("supabase/config.toml", "utf8");
  const files = readdirSync("supabase/templates").filter((name) => name.endsWith(".html"));
  it("covers every email flow and the enabled password-change notice", () => {
    expect(files).toEqual(expect.arrayContaining(["invite.html", "recovery.html", "confirmation.html", "email-change.html", "magic-link.html", "reauthentication.html", "password-changed.html"]));
    expect(config).toMatch(/otp_expiry\s*=\s*3600/);
    expect(config).toContain('site_url = "env(APP_URL)"');
  });
  for (const file of files) it(`${file} is branded, Bahasa, and links only to Buku`, () => {
    const html = readFileSync(`supabase/templates/${file}`, "utf8");
    expect(html).not.toMatch(/ConfirmationURL|supabase|click here|you have|reset your|confirm your|password has/i);
    expect(html).toContain('lang="id"');
    expect(html).toContain('role="presentation"');
    expect(html).toContain('alt="Buku"');
    expect(html).toContain('{{ .SiteURL }}/auth/callback/logo');
    expect(html).toContain('href="{{ .SiteURL }}/syarat"');
    expect(html).toContain('href="{{ .SiteURL }}/kebijakan-privasi"');
    expect(html).toContain('<!-- buku-support -->');
    expect(html).toContain('<!-- /buku-support -->');
    for (const [, url] of html.matchAll(/(?:href|src)="([^"]+)"/g)) expect(url).toMatch(/^\{\{ \.SiteURL \}\}\//);
    if (file !== "password-changed.html") expect(html).toContain("berlaku 1 jam dan hanya sekali pakai");
    expect(config).toContain(`./supabase/templates/${file}`);
    if (!["password-changed.html", "reauthentication.html"].includes(file)) {
      expect(html.match(/token_hash=\{\{ \.TokenHash \}\}/g)?.length).toBe(3); // button + plain link href + visible URL
    }
  });
  it("the invitation has organisation and trial metadata with fallbacks", () => {
    const html = readFileSync("supabase/templates/invite.html", "utf8");
    for (const key of ["org_name", "org_kind", "access_until"]) expect(html).toContain(`.Data.${key}`);
    expect(html).toContain("{{ else }}Anda diundang bergabung ke ruang kerja Buku.");
  });
  it("GET and hydration never consume an email token", () => {
    for (const file of ["page.tsx", "confirm-form.tsx"]) {
      const src = readFileSync(`app/auth/callback/${file}`, "utf8");
      expect(src).not.toMatch(/verifyOtp|exchangeCodeForSession|\.submit\(/);
    }
    expect(readFileSync("app/auth/callback/confirm-form.tsx", "utf8")).toContain('method="post"');
  });
});

describe("email confirmation POST", () => {
  beforeEach(() => {
    vi.stubEnv("APP_URL", "https://buku.test");
    vi.clearAllMocks();
    auth.verifyOtp.mockResolvedValue({ error: null });
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
  });
  const request = (fields: Record<string, string>, origin = "https://buku.test") => new NextRequest("https://buku.test/auth/callback/confirm", {
    method: "POST", headers: { origin }, body: new URLSearchParams(fields),
  });
  it.each(["invite", "recovery"])("verifies %s on POST and redirects without the secret", async (type) => {
    const response = await POST(request({ type, token_hash: "example-token" }));
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type, token_hash: "example-token" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://buku.test/atur-sandi");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("confirms legacy PKCE links only on POST", async () => {
    await POST(request({ code: "pkce-code" }));
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });
  it.each(["https://attacker.test", "null", ""])("refuses foreign or absent origin %s before Auth", async (origin) => {
    expect((await POST(request({ type: "invite", token_hash: "token" }, origin))).status).toBe(403);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });
  it("accepts a no-referrer form only with browser-proven same-origin Fetch Metadata", async () => {
    const local = request({ type: "invite", token_hash: "token" }, "null");
    local.headers.set("sec-fetch-site", "same-origin");
    expect((await POST(local)).headers.get("location")).toBe("https://buku.test/atur-sandi");
    for (const site of ["cross-site", "same-site", "none"]) {
      const foreign = request({ type: "invite", token_hash: "token" }, "null");
      foreign.headers.set("sec-fetch-site", site);
      expect((await POST(foreign)).status).toBe(403);
    }
  });
  it.each([{}, { type: "sms", token_hash: "token" }, { type: "invite", token_hash: ["one", "two"] }, { type: "invite", token_hash: "x".repeat(2049) }, { type: "invite", token_hash: "token", code: "code" }])("refuses malformed or ambiguous tokens", (input) => {
    expect(readLinkToken(input)).toBeNull();
  });
  it("invalid types never reach Auth", async () => {
    const response = await POST(request({ type: "sms", token_hash: "token" }));
    expect(response.headers.get("location")).toBe("https://buku.test/auth/callback?error=invalid");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });
  it("expired and replayed tokens expose neither provider text nor secret", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    auth.verifyOtp.mockResolvedValue({ error: { code: "otp_expired", status: 403, message: "Provider internal detail" } });
    const response = await POST(request({ type: "invite", token_hash: "secret-token" }));
    expect(response.headers.get("location")).toBe("https://buku.test/auth/callback?error=expired");
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/Provider internal|secret-token/);
    log.mockRestore();
  });
});
