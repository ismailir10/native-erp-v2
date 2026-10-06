import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import PDFDocument from "pdfkit";
import { encodePng } from "@/lib/ocr/png";
import { OcrError, pageImages, sniffImageFile } from "@/lib/ocr/pages";
import { proveRows, type OcrRow } from "@/lib/ocr/prove";

const pdfOf = (draw: (doc: PDFKit.PDFDocument) => void) =>
  new Promise<Buffer>((resolve) => {
    const doc = new PDFDocument();
    const parts: Buffer[] = [];
    doc.on("data", (b: Buffer) => parts.push(b));
    doc.on("end", () => resolve(Buffer.concat(parts)));
    draw(doc);
    doc.end();
  });

describe("page images", () => {
  it("encodes pixels as a PNG that decodes back", () => {
    const px = new Uint8Array([10, 20, 30, 40, 50, 60]); // 2×1 RGB
    const png = encodePng(2, 1, 3, px);
    expect(sniffImageFile(png)).toBe("PNG");
    const idat = png.subarray(png.indexOf("IDAT") + 4, png.indexOf("IEND") - 8);
    expect([...inflateSync(idat)]).toEqual([0, 10, 20, 30, 40, 50, 60]);
  });

  it("takes each page's embedded image out of a scanned PDF and never sends a PDF with text", async () => {
    const img = encodePng(40, 20, 1, new Uint8Array(800).fill(128));
    const scan = await pdfOf((doc) => doc.image(img, 10, 10, { width: 400 }));
    const pages = await pageImages(scan);
    expect(pages).toHaveLength(1);
    expect(pages[0].mime).toBe("image/png");
    expect(sniffImageFile(pages[0].data)).toBe("PNG");
    const text = await pdfOf((doc) => doc.text("REKENING KORAN BCA 01/08/2026 SALDO AWAL 1.000.000,00"));
    await expect(pageImages(text)).rejects.toBeInstanceOf(OcrError);
    await expect(pageImages(text)).rejects.toThrow(/berisi teks/);
    expect(await pageImages(img)).toHaveLength(1);
    await expect(pageImages(Buffer.from("a;b;c"))).rejects.toThrow(/bukan scan PDF atau gambar/);
  });
});

describe("proof by running balance", () => {
  const row = (date: string, debit: bigint | null, credit: bigint | null, balance: bigint | null, description = "x"): OcrRow => ({ date, description, debit, credit, balance });

  it("accepts a chain that ties on every row and on the printed closing balance", () => {
    const p = proveRows([row("2026-08-03", null, 500_000n, 1_500_000n), row("2026-08-05", 200_000n, null, 1_300_000n)], 1_000_000n, 1_300_000n);
    expect(p).toMatchObject({ importable: true, problems: 0, closingOk: true });
    expect(p.rows.map((r) => r.state)).toEqual(["OK", "OK"]);
  });

  it("flags one misread amount on its own row only, and a missing balance", () => {
    const p = proveRows([row("2026-08-03", null, 50_000n, 1_500_000n), row("2026-08-05", 200_000n, null, 1_300_000n), row("2026-08-06", 100_000n, null, null), row("2026-08-07", 100_000n, null, 1_100_000n)], 1_000_000n, null);
    expect(p.rows.map((r) => r.state)).toEqual(["BREAK", "OK", "NO_BALANCE", "OK"]);
    expect(p.rows[0].expected).toBe(1_050_000n);
    expect(p).toMatchObject({ importable: false, problems: 2, closingOk: null });
  });

  it("needs an opening balance, a real date, an amount, and the printed closing balance", () => {
    expect(proveRows([row("2026-08-03", null, 1n, 1n)], null, null).rows[0].state).toBe("NO_OPENING");
    expect(proveRows([row("2026-02-30", null, 1n, 1n)], 0n, null).rows[0].state).toBe("BAD_DATE");
    expect(proveRows([row("2026-08-03", null, null, 0n)], 0n, null).rows[0].state).toBe("NO_AMOUNT");
    const p = proveRows([row("2026-08-03", null, 10n, 10n)], 0n, 99n);
    expect(p).toMatchObject({ closingOk: false, importable: false, problems: 1 });
    expect(proveRows([], 0n, null).importable).toBe(false);
  });
});
