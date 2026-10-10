import { randomUUID } from "node:crypto";

/** Server-only boundary for unexpected errors. The browser receives Bahasa and a reference, never provider details. */
export function userMessage(error: unknown, fallback = "Ada yang salah di sisi kami. Coba lagi, atau hubungi pengelola Buku."): string {
  const reference = `BKU-${randomUUID()}`;
  const value = error && typeof error === "object" ? error as { name?: unknown; message?: unknown; code?: unknown; status?: unknown; stack?: unknown } : {};
  const code = typeof value.code === "string" ? value.code : "";
  const messages: Record<string, string> = {
    P2002: "Data ini sudah digunakan. Periksa isian lalu coba lagi.",
    P2003: "Data masih terhubung dengan catatan lain. Periksa kembali sebelum mengubahnya.",
    P2025: "Data tidak ditemukan atau sudah berubah. Muat ulang halaman lalu coba lagi.",
    P2024: "Layanan sedang sibuk. Tunggu sebentar lalu coba lagi.",
    P2028: "Proses terlalu lama sehingga dibatalkan. Coba lagi.",
    invalid_credentials: "Email atau kata sandi tidak cocok.",
    otp_expired: "Tautan sudah kedaluwarsa atau sudah dipakai. Minta tautan baru.",
    over_request_rate_limit: "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.",
    over_email_send_rate_limit: "Terlalu banyak permintaan email. Tunggu sebentar lalu coba lagi.",
  };
  // Exclude nested request/config objects; redact credentials in provider messages and stacks before server logging.
  const redact = (text: unknown) => typeof text === "string" ? text
    .replace(/(https?:\/\/|postgres(?:ql)?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b(password|token|token_hash|access_token|refresh_token|api[_-]?key|secret)(\s*[=:]\s*)[^\s&;,]+/gi, "$1$2[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted]") : undefined;
  console.error(`[Buku ${reference}]`, { name: redact(value.name), code: redact(code), message: redact(value.message), stack: redact(value.stack) });
  const safeFallback = /supabase|prisma|postgres|invalid login credentials|database error|failed to fetch/i.test(fallback)
    ? "Ada yang salah di sisi kami. Coba lagi, atau hubungi pengelola Buku." : fallback;
  const message = Object.hasOwn(messages, code) ? messages[code] : value.status === 429 ? messages.over_request_rate_limit : safeFallback;
  return `${message} Referensi: ${reference}.`;
}
