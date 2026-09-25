import { prisma } from "@/lib/db";
import { createAuth } from "@/lib/auth/config";

let instance: ReturnType<typeof createAuth> | undefined;
/** Lazy initialization lets build-time route discovery run without production credentials. */
export function getAuth() {
  if (instance) return instance;
  const secret = process.env.BETTER_AUTH_SECRET;
  const baseURL = process.env.BETTER_AUTH_URL;
  if (!secret || !baseURL) throw new Error("Akses Buku belum dikonfigurasi. Hubungi pengelola.");
  instance = createAuth(prisma, { secret, baseURL });
  return instance;
}
