import { extractImages, extractText, getDocumentProxy } from "unpdf";
import { encodePng } from "@/lib/ocr/png";

/**
 * The images a vision model reads (I2a): each page's largest embedded image of a scanned PDF (scanners embed one per page), or a
 * JPG/PNG as it is. A PDF with text is never sent: the deterministic parsers read it.
 */
export class OcrError extends Error {}
export type PageImage = { mime: "image/png" | "image/jpeg"; data: Buffer };

export const MAX_PAGES = 10;
export const MAX_PAGE_BYTES = 5 * 1024 * 1024;

export type FileKind = "PDF" | "PNG" | "JPEG" | "OTHER";
export function sniffImageFile(data: Buffer): FileKind {
  if (data.subarray(0, 4).toString("latin1") === "%PDF") return "PDF";
  if (data[0] === 0x89 && data.subarray(1, 4).toString("latin1") === "PNG") return "PNG";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "JPEG";
  return "OTHER";
}

export async function pageImages(data: Buffer): Promise<PageImage[]> {
  const kind = sniffImageFile(data);
  const check = (img: PageImage, page: number) => {
    if (img.data.length > MAX_PAGE_BYTES) throw new OcrError(`Gambar halaman ${page} lebih dari 5 MiB. Scan ulang dengan resolusi 200–300 dpi.`);
    return img;
  };
  if (kind === "PNG") return [check({ mime: "image/png", data }, 1)];
  if (kind === "JPEG") return [check({ mime: "image/jpeg", data }, 1)];
  if (kind !== "PDF") throw new OcrError("File ini bukan scan PDF atau gambar (JPG/PNG).");
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(data));
  } catch {
    throw new OcrError("PDF tidak bisa dibuka. Jika berkata sandi, impor dulu lewat kolom sandi; scan berkata sandi belum didukung.");
  }
  const { text } = await extractText(pdf, { mergePages: true });
  if (text.replace(/\s/g, "").length >= 20) throw new OcrError("PDF ini berisi teks, jadi dibaca langsung tanpa AI. Impor seperti biasa.");
  if (pdf.numPages > MAX_PAGES) throw new OcrError(`Scan ini ${pdf.numPages} halaman; maksimal ${MAX_PAGES}. Pecah per bulan.`);
  const out: PageImage[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const images = await extractImages(pdf, p);
    const best = images.sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!best) throw new OcrError(`Halaman ${p} tidak berisi gambar scan. Scan sebagai gambar, atau minta e-statement.`);
    out.push(check({ mime: "image/png", data: encodePng(best.width, best.height, best.channels as 1 | 3 | 4, best.data) }, p));
  }
  return out;
}
