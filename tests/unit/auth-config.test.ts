import { describe, expect, it, vi } from "vitest";
import { buildAuthPayload, diffAuthConfig, readAuthToml, runAuthConfig } from "@/scripts/auth-config";

const root = process.cwd();
const env = { APP_URL: "https://buku.example", BUKU_SUPPORT_EMAIL: "dukungan@buku.example", SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", SUPABASE_ACCESS_TOKEN: "private-management-token" };
const desired = () => buildAuthPayload(root, { appUrl: env.APP_URL, supportEmail: env.BUKU_SUPPORT_EMAIL });

describe("auth email configuration from the repository", () => {
  it("maps local subjects, templates, expiry and redirect paths into the public Management API fields", () => {
    const payload = desired();
    expect(payload).toMatchObject({
      site_url: "https://buku.example", uri_allow_list: "https://buku.example/auth/callback", smtp_sender_name: "Buku",
      mailer_otp_exp: 3600, mailer_subjects_invite: "Undangan ke Buku", mailer_subjects_recovery: "Atur ulang kata sandi Buku",
      mailer_notifications_password_changed_enabled: true,
    });
    for (const [key, value] of Object.entries(payload)) if (key.startsWith("mailer_templates_")) {
      expect(value).toContain('mailto:dukungan%40buku.example');
      expect(value).toContain('href="{{ .SiteURL }}/syarat"');
      expect(value).toContain('href="{{ .SiteURL }}/kebijakan-privasi"');
      expect(value).not.toMatch(/ConfirmationURL|supabase|<!-- buku-support -->/i);
    }
    expect(payload.mailer_templates_invite_content).toContain("{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}");
    expect(payload).not.toHaveProperty("smtp_pass");
    expect(payload).not.toHaveProperty("smtp_user");
  });
  it("diffs only owned keys and preserves other hosted settings", () => {
    const payload = desired();
    const current = { ...payload, mailer_otp_exp: 86400, smtp_sender_name: "Old name", smtp_pass: "private-password" };
    expect(diffAuthConfig(current, payload)).toEqual([
      { key: "mailer_otp_exp", before: 86400, after: 3600 },
      { key: "smtp_sender_name", before: "Old name", after: "Buku" },
    ]);
    expect(diffAuthConfig(payload, payload)).toEqual([]);
  });
  it.each(["", "http://buku.example", "https://user:secret@buku.example", "https://buku.example/path", "https://buku.example/?secret=value", "https://localhost"])("rejects an unsafe hosted origin %s", (appUrl) => {
    expect(() => buildAuthPayload(root, { appUrl, supportEmail: env.BUKU_SUPPORT_EMAIL })).toThrow();
  });
  it("requires a real operator-selected support address and escapes it", () => {
    expect(() => buildAuthPayload(root, { appUrl: env.APP_URL, supportEmail: "" })).toThrow(/BUKU_SUPPORT_EMAIL/);
    const payload = buildAuthPayload(root, { appUrl: env.APP_URL, supportEmail: "help&care@buku.example" });
    expect(payload.mailer_templates_invite_content).toContain("help&amp;care@buku.example");
  });
  it("fails closed on duplicate or unsupported TOML instead of guessing", () => {
    expect(() => readAuthToml('[auth]\nsite_url = "one"\nsite_url = "two"')).toThrow(/berulang/);
    expect(() => readAuthToml('[auth.email]\notp_expiry = not-a-literal')).toThrow(/literal/);
    expect(() => readAuthToml('[auth]\n[auth]')).toThrow(/diulang/);
  });
});

describe("dry run and explicit apply", () => {
  it("GETs and prints a field diff by default, without printing secrets or PATCHing", async () => {
    const payload = desired();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ...payload, smtp_sender_name: "private-old-value", smtp_pass: "private-smtp-password" })));
    const log = vi.fn();
    const result = await runAuthConfig({ args: [], env, root, fetcher, log });
    expect(result.applied).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/config/auth");
    expect(fetcher.mock.calls[0][1]?.method).toBeUndefined();
    expect(log.mock.calls.flat().join("\n")).toContain("smtp_sender_name:");
    expect(log.mock.calls.flat().join("\n")).toContain("Pratinjau saja");
    expect(log.mock.calls.flat().join("\n")).not.toMatch(/private-/);
  });
  it("PATCHes only changed public fields when --apply is explicit", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ ...desired(), mailer_otp_exp: 86400 }))).mockResolvedValueOnce(new Response("{}"));
    const result = await runAuthConfig({ args: ["--apply"], env, root, fetcher, log: vi.fn() });
    expect(result.applied).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1]?.method).toBe("PATCH");
    expect(JSON.parse(fetcher.mock.calls[1][1]?.body as string)).toEqual({ mailer_otp_exp: 3600 });
  });
  it("does not PATCH an already matching project", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(desired())));
    expect((await runAuthConfig({ args: ["--apply"], env, root, fetcher, log: vi.fn() })).applied).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([{ ...env, SUPABASE_PROJECT_REF: "" }, { ...env, SUPABASE_PROJECT_REF: "../other" }, { ...env, SUPABASE_ACCESS_TOKEN: "" }])("requires project and token from the environment before network access", async (settings) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(runAuthConfig({ args: [], env: settings, root, fetcher })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses project selection via command line", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(runAuthConfig({ args: ["--project-ref", "another-project"], env, root, fetcher })).rejects.toThrow(/Gunakan/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not disable or overlook an enabled unbranded hosted notification", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ...desired(), mailer_notifications_email_changed_enabled: true })));
    await expect(runAuthConfig({ args: ["--apply"], env, root, fetcher })).rejects.toThrow(/Tambahkan template/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("HTTP failure bodies never appear in the diagnostic", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("private-server-response", { status: 403 }));
    const log = vi.fn();
    await expect(runAuthConfig({ args: [], env, root, fetcher, log })).rejects.toThrow("HTTP 403");
    expect(log).not.toHaveBeenCalled();
  });
});
