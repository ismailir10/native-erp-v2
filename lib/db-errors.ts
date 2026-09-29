import { Prisma } from "@/lib/generated/prisma/client";

/**
 * Infrastructure failures the accountant can act on, in Bahasa. A transaction that ran past its timeout (P2028) or a
 * connection pool that stayed full (P2024) rolled back completely, so nothing was saved and trying again is safe.
 */
export function infraErrorMessage(e: unknown): string | null {
  if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2028" || e.code === "P2024")) {
    return "Proses terlalu lama sehingga dibatalkan; tidak ada yang tersimpan. Coba lagi. Kalau terulang, simpan sebagian dulu.";
  }
  return null;
}
