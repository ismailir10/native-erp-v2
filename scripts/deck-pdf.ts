/**
 * Renders the public decks to PDF (one 16:9 page per slide) so /deck can offer a download that looks the same everywhere.
 * Run after editing public/deck/*.html: `npm run deck:pdf`. Uses the e2e Chromium (set PW_CHROMIUM in a sandbox with a preinstalled one).
 * Reduced motion is emulated, so no entrance or count-up is caught mid-flight; print CSS in deck.css does the rest.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "@playwright/test";

const ROOT = join(process.cwd(), "public");
const DECKS = [
  { html: "/deck/kantor.html", pdf: "public/deck/buku-kantor-akuntan.pdf" },
  { html: "/deck/perusahaan.html", pdf: "public/deck/buku-perusahaan.pdf" },
];
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]));
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});

async function main() {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  try {
    for (const deck of DECKS) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, reducedMotion: "reduce" });
      await page.goto(`http://127.0.0.1:${port}${deck.html}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const slides = await page.locator(".slide").count();
      await page.pdf({ path: deck.pdf, width: "1600px", height: "900px", printBackground: true, preferCSSPageSize: true });
      console.log(`${deck.pdf}: ${slides} slides`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
