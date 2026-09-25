import { afterEach, describe, expect, it, vi } from "vitest";
import { sendLoginCode } from "@/lib/auth/email";

describe("login code delivery", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it("fails closed when mail delivery is not configured", async () => {
    vi.stubEnv("RESEND_API_KEY", ""); vi.stubEnv("AUTH_EMAIL_FROM", "");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(sendLoginCode("member@example.test", "123456")).rejects.toThrow("Pengiriman kode belum siap");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("sends only the sign-in message through configured Resend and surfaces transport failure", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-token"); vi.stubEnv("AUTH_EMAIL_FROM", "Buku <login@example.test>");
    const fetch = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal("fetch", fetch);
    await sendLoginCode("member@example.test", "123456");
    expect(fetch).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" } }));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ to: ["member@example.test"], from: "Buku <login@example.test>", subject: "Kode masuk Buku", text: expect.stringContaining("123456") });
    fetch.mockResolvedValue({ ok: false });
    await expect(sendLoginCode("member@example.test", "123456")).rejects.toThrow("Kode belum terkirim");
  });
});
