/** Delivery adapter. Tests inject a sender; production never prints one-time codes. */
export async function sendLoginCode(email: string, otp: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;
  if (!key || !from) throw new Error("Pengiriman kode belum siap. Hubungi pengelola Buku.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [email], subject: "Kode masuk Buku", text: `Kode masuk Buku Anda: ${otp}\n\nBerlaku 5 menit. Jangan bagikan kode ini. Abaikan pesan ini bila Anda tidak meminta masuk.` }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Kode belum terkirim. Coba lagi atau hubungi pengelola Buku.");
}
