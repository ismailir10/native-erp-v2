import { prisma } from "@/lib/db";
import { createAuth } from "@/lib/auth/config";

let instance: ReturnType<typeof createAuth> | undefined;
export function authConfigured() {
  return Boolean(process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_URL
    && (process.env.AUTH_MODE !== "shared-code" || /^\d{12}$/.test(process.env.AUTH_SHARED_CODE ?? "")));
}
/** Lazy initialization lets build-time route discovery run without production credentials. */
export function getAuth() {
  if (instance) return instance;
  const secret = process.env.BETTER_AUTH_SECRET;
  const baseURL = process.env.BETTER_AUTH_URL;
  if (!secret || !baseURL || !authConfigured()) throw new Error("Akses Buku belum dikonfigurasi. Hubungi pengelola.");
  instance = createAuth(prisma, { secret, baseURL, ...(process.env.AUTH_MODE === "shared-code" ? { sharedCode: process.env.AUTH_SHARED_CODE } : {}) });
  return instance;
}
