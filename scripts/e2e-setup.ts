import "dotenv/config";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createPrisma } from "../lib/db";
import { createAuth } from "../lib/auth/config";
import { inviteUser } from "../lib/auth/operator";

/** Seed synthetic books, then use the real OTP flow with a captured test transport. No server bypass. */
async function setup() {
  const baseURL = process.env.BASE_URL ?? "http://localhost:3200";
  const database = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1", "::1"].includes(database.hostname) || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) throw new Error("E2E setup only accepts disposable localhost environments.");
  execSync("npx tsx scripts/seed.ts", { stdio: "inherit", env: process.env });
  const db = createPrisma();
  try {
    const firm = await db.firm.findFirstOrThrow();
    const email = "accountant@buku.example";
    await inviteUser(db, { firmId: firm.id, email, name: "Akuntan uji" });
    let otp = "";
    const sharedCode = process.env.AUTH_MODE === "shared-code" ? process.env.AUTH_SHARED_CODE : undefined;
    const auth = createAuth(db, { baseURL, secret: process.env.BETTER_AUTH_SECRET!, ...(sharedCode ? { sharedCode } : {}), sendCode: async (_email, code) => { otp = code; } });
    const post = (path: string, body: object) => auth.handler(new Request(`${baseURL}/api/auth${path}`, { method: "POST", headers: { "content-type": "application/json", origin: baseURL, "x-forwarded-for": "192.0.2.200" }, body: JSON.stringify(body) }));
    if (!sharedCode) {
      const sent = await post("/email-otp/send-verification-otp", { email, type: "sign-in" });
      if (sent.status !== 200 || !otp) throw new Error("Synthetic invitation code could not be issued.");
    }
    const signedIn = sharedCode ? await post("/sign-in/shared-code", { email, code: sharedCode }) : await post("/sign-in/email-otp", { email, otp });
    if (signedIn.status !== 200) throw new Error("Synthetic account could not sign in.");
    const cookies = signedIn.headers.getSetCookie().map(header => {
      const [pair, ...attributes] = header.split(";");
      const delimiter = pair.indexOf("=");
      const maxAge = attributes.find(value => value.trim().toLowerCase().startsWith("max-age="))?.split("=")[1];
      return { name: pair.slice(0, delimiter), value: pair.slice(delimiter + 1), domain: new URL(baseURL).hostname, path: "/", expires: maxAge ? Math.floor(Date.now() / 1000) + Number(maxAge) : -1, httpOnly: true, secure: false, sameSite: "Lax" as const };
    });
    mkdirSync(".playwright", { recursive: true });
    writeFileSync(".playwright/auth.json", JSON.stringify({ cookies, origins: [] }), { mode: 0o600 });
  } finally { await db.$disconnect(); }
}

setup().catch(error => { console.error(error); process.exitCode = 1; });
