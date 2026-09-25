import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { createHash } from "node:crypto";
import type { Db } from "@/lib/db";
import { sendLoginCode } from "./email";

const allowedPaths = new Set(["/email-otp/send-verification-otp", "/sign-in/email-otp", "/get-session", "/sign-out"]);

/** Database lock makes per-address delivery limits survive instances and concurrent requests. */
async function limitDelivery(db: Db, email: string) {
  const key = `email:${createHash("sha256").update(email).digest("hex")}`;
  const allowed = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`;
    const row = await tx.authRateLimit.findUnique({ where: { key } });
    const now = BigInt(Date.now());
    if (row && now - row.lastRequest < 600_000n && row.count >= 3) return false;
    const fresh = !row || now - row.lastRequest >= 600_000n;
    await tx.authRateLimit.upsert({ where: { key }, create: { key, count: 1, lastRequest: now }, update: { count: fresh ? 1 : row.count + 1, lastRequest: fresh ? now : row.lastRequest } });
    return true;
  });
  if (!allowed) throw new APIError("TOO_MANY_REQUESTS", { message: "Terlalu banyak permintaan kode. Tunggu 10 menit lalu coba lagi." });
}

/** Dependency injection is for transport tests; production always uses the same authentication rules. */
export function createAuth(db: Db, config: { secret: string; baseURL: string; sendCode?: (email: string, otp: string) => Promise<void> }) {
  if (config.secret.length < 32) throw new Error("BETTER_AUTH_SECRET harus berisi sedikitnya 32 karakter.");
  const origin = new URL(config.baseURL);
  if (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))) throw new Error("BETTER_AUTH_URL harus memakai HTTPS, kecuali localhost.");
  if (origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) throw new Error("BETTER_AUTH_URL harus berupa origin, tanpa path atau kredensial.");
  return betterAuth({
    appName: "Buku",
    secret: config.secret,
    baseURL: config.baseURL,
    // Better Auth defaults origin checks off under NODE_ENV=test; exercise real defenses in every environment.
    advanced: { disableOriginCheck: false, disableCSRFCheck: false },
    database: prismaAdapter(db, { provider: "postgresql", transaction: true }),
    user: { modelName: "AuthUser", additionalFields: { firmId: { type: "string", required: true, input: false }, disabled: { type: "boolean", defaultValue: false, input: false } } },
    session: { modelName: "AuthSession", expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    account: { modelName: "AuthAccount" },
    verification: { modelName: "AuthVerification" },
    rateLimit: { enabled: true, storage: "database", modelName: "AuthRateLimit", window: 60, max: 60, customRules: { "/email-otp/send-verification-otp": { window: 60, max: 3 }, "/sign-in/email-otp": { window: 60, max: 5 } } },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Login starts without cookies. Require its browser Origin too, before any delivery or mutation.
        // Server API calls have no Request; Next.js separately checks their Server Action origin.
        if (ctx.request && !["GET", "HEAD", "OPTIONS"].includes(ctx.request.method)) {
          if (ctx.request.headers.get("origin") !== origin.origin) throw new APIError("FORBIDDEN", { message: "Asal permintaan tidak diizinkan. Buka Buku dari alamat kantor Anda." });
        }
        if (!allowedPaths.has(ctx.path)) throw new APIError("NOT_FOUND", { message: "Jalur masuk tidak tersedia." });
        if (ctx.path === "/email-otp/send-verification-otp") {
          if (ctx.body?.type !== "sign-in") throw new APIError("BAD_REQUEST", { message: "Gunakan kode masuk Buku." });
          if (typeof ctx.body?.email === "string") await limitDelivery(db, ctx.body.email.trim().toLowerCase());
        }
      }),
    },
    databaseHooks: {
      user: { create: { before: async () => { throw new APIError("FORBIDDEN", { message: "Akses hanya melalui undangan pengelola." }); } } },
      session: { create: { before: async (session) => {
        const user = await db.authUser.findUnique({ where: { id: session.userId } });
        if (!user || user.disabled) throw new APIError("FORBIDDEN", { message: "Akses tidak tersedia. Hubungi pengelola Buku." });
      } } },
    },
    plugins: [emailOTP({
      disableSignUp: true, storeOTP: "hashed", expiresIn: 300, allowedAttempts: 3,
      async sendVerificationOTP({ email, otp, type }) {
        const user = await db.authUser.findUnique({ where: { email } });
        if (type !== "sign-in" || !user || user.disabled) return;
        await (config.sendCode ?? sendLoginCode)(email, otp);
      },
    })],
  });
}
