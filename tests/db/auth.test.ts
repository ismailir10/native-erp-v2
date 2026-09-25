import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "../helpers";
import { createAuth } from "@/lib/auth/config";
import { initializeWorkspace, inviteUser, revokeUser } from "@/lib/auth/operator";

const baseURL = "http://localhost:3000";
const secret = "buku-tests-only-secret-with-at-least-32-characters";
const email = "member@example.test";
let otp = "";
const sendCode = vi.fn(async (_email: string, code: string) => { otp = code; });
let auth: ReturnType<typeof createAuth>;
async function request(path: string, body?: object, cookie?: string, ip = "192.0.2.10") {
  return auth.handler(new Request(`${baseURL}/api/auth${path}`, {
    method: body ? "POST" : "GET", headers: { "content-type": "application/json", origin: baseURL, "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
}
async function invite() {
  const firm = await db.firm.create({ data: { name: "Invited firm" } });
  const user = await inviteUser(db, { email, name: "Member", firmId: firm.id });
  return { firm, user };
}
async function signIn() {
  expect((await request("/email-otp/send-verification-otp", { email, type: "sign-in" })).status).toBe(200);
  const response = await request("/sign-in/email-otp", { email, otp });
  expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  return { response, cookie };
}

describe("invitation-only authentication", () => {
  beforeEach(async () => {
    await resetDb(); sendCode.mockClear(); otp = "";
    auth = createAuth(db, { secret, baseURL, sendCode });
  });

  it("bootstraps exactly one firm under concurrent operator requests", async () => {
    const results = await Promise.allSettled([initializeWorkspace(db, "Kantor"), initializeWorkspace(db, "Other")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.firm.count()).toBe(1);
  });

  it("does not register or send codes to uninvited addresses", async () => {
    const response = await request("/email-otp/send-verification-otp", { email, type: "sign-in" });
    expect(response.status).toBe(200);
    expect(sendCode).not.toHaveBeenCalled();
    expect(await db.authUser.count()).toBe(0);
    expect(await db.authVerification.count()).toBe(0);
    expect((await request("/sign-up/email", { email, password: "not-enabled-password", name: "No" })).status).not.toBe(200);
    expect((await request("/sign-in/email-otp", { email, otp: "000000" })).status).not.toBe(200);
  });

  it("stores hashed expiring codes, creates a firm session, and rejects code reuse", async () => {
    const { firm, user } = await invite();
    expect((await request("/email-otp/send-verification-otp", { email, type: "sign-in" })).status).toBe(200);
    expect(otp).toMatch(/^\d{6}$/);
    const record = await db.authVerification.findFirstOrThrow();
    expect(record.value).not.toContain(otp);
    expect(record.expiresAt.getTime() - Date.now()).toBeGreaterThan(290_000);
    expect(record.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(300_000);
    const response = await request("/sign-in/email-otp", { email, otp });
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const session = await (await request("/get-session", undefined, cookie)).json();
    expect(session.user).toMatchObject({ id: user.id, firmId: firm.id, emailVerified: true });
    expect((await request("/sign-in/email-otp", { email, otp })).status).not.toBe(200);
    expect(await db.authSession.count()).toBe(1);
  });

  it("rejects expired codes and exhausted attempt limits", async () => {
    await invite();
    await request("/email-otp/send-verification-otp", { email, type: "sign-in" });
    await db.authVerification.updateMany({ data: { expiresAt: new Date(Date.now() - 1_000) } });
    expect((await request("/sign-in/email-otp", { email, otp })).status).not.toBe(200);
    await request("/email-otp/send-verification-otp", { email, type: "sign-in" });
    const wrong = otp === "000000" ? "111111" : "000000";
    for (let attempt = 0; attempt < 3; attempt++) expect((await request("/sign-in/email-otp", { email, otp: wrong })).status).not.toBe(200);
    expect((await request("/sign-in/email-otp", { email, otp }, undefined, "192.0.2.11")).status).not.toBe(200);
    expect(await db.authSession.count()).toBe(0);
  });

  it("persists rate limits across instances and limits one address across IPs", async () => {
    await invite();
    for (let attempt = 0; attempt < 3; attempt++) expect((await request("/email-otp/send-verification-otp", { email, type: "sign-in" }, undefined, `192.0.2.${20 + attempt}`)).status).toBe(200);
    auth = createAuth(db, { secret, baseURL, sendCode });
    expect((await request("/email-otp/send-verification-otp", { email, type: "sign-in" }, undefined, "192.0.2.30")).status).toBe(429);
    expect(sendCode).toHaveBeenCalledTimes(3);
    expect(await db.authRateLimit.count()).toBeGreaterThan(0);
  });

  it("revocation invalidates sessions and outstanding codes; reinvitation cannot cross firms", async () => {
    const { firm } = await invite();
    const { cookie } = await signIn();
    await request("/email-otp/send-verification-otp", { email, type: "sign-in" });
    const unused = otp;
    await revokeUser(db, { email, firmId: firm.id });
    expect(await (await request("/get-session", undefined, cookie)).json()).toBeNull();
    expect((await request("/sign-in/email-otp", { email, otp: unused })).status).not.toBe(200);
    await request("/email-otp/send-verification-otp", { email, type: "sign-in" });
    expect(sendCode).toHaveBeenCalledTimes(2);
    const other = await db.firm.create({ data: { name: "Other" } });
    await expect(inviteUser(db, { email, name: "Member", firmId: other.id })).rejects.toThrow("kantor lain");
    await inviteUser(db, { email, name: "Member", firmId: firm.id });
    expect((await request("/sign-in/email-otp", { email, otp: unused })).status).not.toBe(200);
  });

  it("rejects foreign origins and signs out the persisted session", async () => {
    await invite();
    const foreign = await auth.handler(new Request(`${baseURL}/api/auth/email-otp/send-verification-otp`, {
      method: "POST", headers: { "content-type": "application/json", origin: "https://untrusted.example", "x-forwarded-for": "192.0.2.41" },
      body: JSON.stringify({ email, type: "sign-in" }),
    }));
    expect(foreign.status).toBe(403);
    const missing = await auth.handler(new Request(`${baseURL}/api/auth/email-otp/send-verification-otp`, {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.42" },
      body: JSON.stringify({ email, type: "sign-in" }),
    }));
    expect(missing.status).toBe(403);
    expect(sendCode).not.toHaveBeenCalled();
    const { cookie } = await signIn();
    expect((await request("/sign-out", {}, cookie)).status).toBe(200);
    expect(await db.authSession.count()).toBe(0);
    expect(await (await request("/get-session", undefined, cookie)).json()).toBeNull();
  });

  it("supports sign-out through the server API with forwarded action headers", async () => {
    await invite();
    const { cookie } = await signIn();
    await auth.api.signOut({ headers: new Headers({ cookie, origin: baseURL, "x-forwarded-host": "localhost:3000", "x-forwarded-proto": "http" }) });
    expect(await db.authSession.count()).toBe(0);
  });

  it("blocks session creation for disabled users even if they possess a valid code", async () => {
    const { user } = await invite();
    await request("/email-otp/send-verification-otp", { email, type: "sign-in" });
    await db.authUser.update({ where: { id: user.id }, data: { disabled: true } });
    expect((await request("/sign-in/email-otp", { email, otp })).status).toBe(403);
    expect(await db.authSession.count()).toBe(0);
  });
});
