import { expect, test } from "@playwright/test";
import { deflateSync, crc32 } from "node:zlib";
import { addClient, uploadStatement } from "./qa-helpers";

/**
 * Scanned statements (I2a): a photo or scan is never read as text; the import says so and points to the workspace switch, which only
 * an admin sees in Pengaturan (off by default, UU PDP). CI has no AI key, so the transcription itself is covered by DB tests.
 */
function tinyPng(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from([0, 128]))), chunk("IEND", Buffer.alloc(0))]);
}

test("a photographed statement is explained and points to Baca scan dengan AI", async ({ page }) => {
  await page.goto("/settings");
  const setting = page.getByTestId("ocr-setting");
  await expect(setting).toContainText("Baca scan dengan AI");
  await expect(setting).toContainText("UU PDP");
  await expect(setting.getByRole("checkbox", { name: "Izinkan Buku mengirim gambar scan rekening koran ke penyedia AI" })).toBeVisible();

  const id = await addClient(page, { name: "QA Scan" });
  await uploadStatement(page, id, "foto-rekening.png", tinyPng(), "image/png");
  const notice = page.getByTestId("scan-notice");
  await expect(notice).toContainText("File ini gambar (foto atau scan) rekening koran");
  await expect(notice).toContainText(/Baca scan dengan AI/);
});
