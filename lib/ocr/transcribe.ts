import { sourceCurrency } from "@/lib/import/parsers/common";
import { readAmount } from "@/lib/ocr/amount";
import { OcrError } from "@/lib/ocr/pages";
import type { PageImage } from "@/lib/ocr/pages";

/**
 * What the vision model is asked for (I2a): a transcription, never arithmetic. It gets only the page images: no expected balance,
 * no earlier statement, no account list. Amounts come back as printed text and are parsed by Buku.
 */
export type OcrInput = { images: PageImage[] };
export type OcrTranscriptRow = { date: string; description: string; debit: string; credit: string; balance: string };
export type OcrTranscript = { bank: string; accountNumber: string; periodStart: string; periodEnd: string; opening: string; closing: string; currency?: string; rows: OcrTranscriptRow[] };

export const OCR_PROMPT_VERSION = "ocr-v2";
export const OCR_MAX_ROWS = 2000;
export const OCR_MAX_TOKENS = 12_000;
export const OCR_TOKENS_PER_PAGE = 2_500;

export function buildOcrPrompt(pages: number) {
  const system = [
    "Anda menyalin rekening koran bank Indonesia dari gambar scan. Tugas Anda hanya menyalin, bukan menghitung.",
    "Salin setiap baris transaksi persis seperti tercetak: tanggal, keterangan, debet, kredit, saldo.",
    "Jangan pernah menghitung, menebak, melengkapi atau membetulkan angka. Jika sebuah angka tidak terbaca atau tidak tercetak, isi string kosong.",
    "Tanggal ditulis YYYY-MM-DD; rekening koran Indonesia mencetak hari dulu lalu bulan. Jika tahun tidak tercetak di baris, ambil dari periode di kepala halaman.",
    "Angka disalin sebagai teks seperti tercetak (mis. 1.250.000,00). Baris SALDO AWAL dan SALDO AKHIR bukan transaksi: isi ke opening dan closing.",
    "Salin kode mata uang yang tercetak ke currency (mis. IDR atau USD); kosongkan jika tidak tercetak. Jangan menganggap semua rekening dalam Rupiah.",
    'Jawab JSON saja: {"bank":"","currency":"","accountNumber":"","periodStart":"YYYY-MM-DD","periodEnd":"YYYY-MM-DD","opening":"","closing":"","rows":[{"date":"","description":"","debit":"","credit":"","balance":""}]}',
  ].join("\n");
  const user = `Salin rekening koran pada ${pages} halaman gambar berikut, urut dari atas ke bawah.`;
  return { system, user };
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

export function parseOcrTranscript(text: string): OcrTranscript {
  const body = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const start = body.indexOf("{");
  const v = JSON.parse(start >= 0 ? body.slice(start, body.lastIndexOf("}") + 1) : body) as Record<string, unknown>;
  if (!v || typeof v !== "object" || !Array.isArray(v.rows)) throw new OcrError("Jawaban AI tidak memuat daftar transaksi yang valid. Baca ulang scan.");
  for (const key of ["opening", "closing"]) {
    if (v[key] !== undefined && typeof v[key] !== "string") throw new OcrError("Saldo hasil AI harus disalin sebagai teks, bukan angka JSON. Baca ulang scan.");
  }
  const rows = v.rows;
  if (rows.length > OCR_MAX_ROWS) throw new OcrError("Hasil scan melebihi 2.000 baris. Pecah file per bulan atau tanggal; tidak ada baris yang dipotong.");
  if (str(v.currency) && !/^(IDR|Rp\.?|Rupiah)$/i.test(str(v.currency))) throw new OcrError(`Mata uang ${str(v.currency)} belum didukung untuk impor bank. Gunakan rekening koran IDR.`);
  const currency = sourceCurrency(str(v.currency) ? [`Currency: ${str(v.currency)}`] : [], [], [str(v.opening), str(v.closing), ...rows.flatMap((r) => r && typeof r === "object" ? [str(r.debit), str(r.credit), str(r.balance)] : [])]);
  for (const value of [v.opening, v.closing, ...rows.flatMap((r) => r && typeof r === "object" ? [r.debit, r.credit, r.balance] : [])]) {
    if (str(value) && readAmount(str(value)) === null) throw new OcrError(`Angka hasil scan "${str(value)}" tidak terbaca sebagai Rupiah. Baca ulang scan yang lebih jelas; angka tidak boleh diabaikan.`);
  }
  return {
    bank: str(v.bank),
    ...(currency ? { currency } : {}),
    accountNumber: str(v.accountNumber),
    periodStart: str(v.periodStart),
    periodEnd: str(v.periodEnd),
    opening: str(v.opening),
    closing: str(v.closing),
    rows: rows.map((r, i) => {
      if (!r || typeof r !== "object" || Array.isArray(r) || ["date", "description", "debit", "credit", "balance"].some((key) => typeof r[key] !== "string")) {
        throw new OcrError(`Baris ${i + 1} hasil AI tidak valid. Semua tanggal, keterangan, dan angka harus disalin sebagai teks; baca ulang scan.`);
      }
      const o = r as Record<string, unknown>;
      return { date: str(o.date), description: str(o.description).slice(0, 240), debit: str(o.debit), credit: str(o.credit), balance: str(o.balance) };
    }),
  };
}
