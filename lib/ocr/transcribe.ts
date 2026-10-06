import type { PageImage } from "@/lib/ocr/pages";

/**
 * What the vision model is asked for (I2a): a transcription, never arithmetic. It gets only the page images: no expected balance,
 * no earlier statement, no account list. Amounts come back as printed text and are parsed by Buku.
 */
export type OcrInput = { images: PageImage[] };
export type OcrTranscriptRow = { date: string; description: string; debit: string; credit: string; balance: string };
export type OcrTranscript = { bank: string; accountNumber: string; periodStart: string; periodEnd: string; opening: string; closing: string; rows: OcrTranscriptRow[] };

export const OCR_PROMPT_VERSION = "ocr-v1";
export const OCR_MAX_TOKENS = 12_000;
export const OCR_TOKENS_PER_PAGE = 2_500;

export function buildOcrPrompt(pages: number) {
  const system = [
    "Anda menyalin rekening koran bank Indonesia dari gambar scan. Tugas Anda hanya menyalin, bukan menghitung.",
    "Salin setiap baris transaksi persis seperti tercetak: tanggal, keterangan, debet, kredit, saldo.",
    "Jangan pernah menghitung, menebak, melengkapi atau membetulkan angka. Jika sebuah angka tidak terbaca atau tidak tercetak, isi string kosong.",
    "Tanggal ditulis YYYY-MM-DD; rekening koran Indonesia mencetak hari dulu lalu bulan. Jika tahun tidak tercetak di baris, ambil dari periode di kepala halaman.",
    "Angka disalin sebagai teks seperti tercetak (mis. 1.250.000,00). Baris SALDO AWAL dan SALDO AKHIR bukan transaksi: isi ke opening dan closing.",
    'Jawab JSON saja: {"bank":"","accountNumber":"","periodStart":"YYYY-MM-DD","periodEnd":"YYYY-MM-DD","opening":"","closing":"","rows":[{"date":"","description":"","debit":"","credit":"","balance":""}]}',
  ].join("\n");
  const user = `Salin rekening koran pada ${pages} halaman gambar berikut, urut dari atas ke bawah.`;
  return { system, user };
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

export function parseOcrTranscript(text: string): OcrTranscript {
  const body = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const start = body.indexOf("{");
  const v = JSON.parse(start >= 0 ? body.slice(start, body.lastIndexOf("}") + 1) : body) as Record<string, unknown>;
  const rows = Array.isArray(v.rows) ? v.rows : [];
  return {
    bank: str(v.bank),
    accountNumber: str(v.accountNumber),
    periodStart: str(v.periodStart),
    periodEnd: str(v.periodEnd),
    opening: str(v.opening),
    closing: str(v.closing),
    rows: rows.slice(0, 2000).map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return { date: str(o.date), description: str(o.description).slice(0, 240), debit: str(o.debit), credit: str(o.credit), balance: str(o.balance) };
    }),
  };
}
