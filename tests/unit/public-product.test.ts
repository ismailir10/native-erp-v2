// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { PublicLanding } from "@/components/app/public-landing";
import { PUBLIC_BANK_COUNT, PUBLIC_BANK_COVERAGE } from "@/lib/public-product";
import capture from "@/public/product/capture-manifest.json";

vi.mock("@/components/app/public-site-frame", () => ({ PublicSiteFrame: ({ children }: { children: React.ReactNode }) => children }));
const render = () => {
  const dom = document.implementation.createHTMLDocument();
  dom.body.innerHTML = renderToStaticMarkup(createElement(PublicLanding));
  return dom;
};

describe("saved public product evidence", () => {
  it("renders the actual bank claims and qualifies inferred formats", () => {
    const dom = render();
    const disclosure = dom.querySelector("[data-testid='public-bank-formats']")!;
    expect(disclosure.querySelector("summary")?.textContent).toContain(`(${PUBLIC_BANK_COUNT} bank)`);
    expect(disclosure.textContent).toContain("bukan semua file dari bank yang sama");
    const rows = [...disclosure.querySelectorAll("dl > div")];
    expect(rows).toHaveLength(PUBLIC_BANK_COVERAGE.length);
    for (const claim of PUBLIC_BANK_COVERAGE) {
      const row = rows.find((entry) => entry.querySelector("dt")?.textContent === claim.name)!;
      for (const format of claim.formats) expect(row.querySelector("dd")?.textContent).toContain(format.label);
      if (claim.formats.some((format) => format.evidence === "INFERRED")) expect(row.textContent).toContain("pola umum, belum contoh asli");
    }
  });

  it("pairs three product sections with genuine, labelled responsive screenshots", () => {
    const dom = render();
    expect(dom.querySelectorAll("h1")).toHaveLength(1);
    expect(dom.querySelector("h1")?.textContent).toBe("Dari rekening koran ke laporan keuangan.");
    expect(dom.querySelector("#firm-title")?.closest("section")?.querySelector("figure")).not.toBeNull();
    expect(dom.querySelector("#company-title")?.closest("section")?.querySelector("figure")).not.toBeNull();
    const illustration = dom.querySelector("svg[role='img']")!;
    expect(illustration.getAttribute("aria-label")).toContain(`${capture.source.fileName} baris ${capture.source.rowNumber}`);
    for (const line of capture.source.lines) expect(illustration.textContent).toContain(line.code);
    expect(illustration.closest("figure")?.querySelector("figcaption")?.textContent).toContain("Ilustrasi alur berdasarkan data demo sintetis");
    const figures = [...dom.querySelectorAll("figure")].filter((figure) => figure.querySelector("img"));
    expect(figures).toHaveLength(6);
    for (const figure of figures) {
      expect(figure.querySelector("figcaption")?.textContent).toContain("Data demonstrasi sintetis");
      const img = figure.querySelector("img")!;
      expect(img.alt.length).toBeGreaterThan(30);
      expect(img.getAttribute("width")).toBeTruthy();
      expect(img.getAttribute("height")).toBeTruthy();
      if (figure.querySelector("picture")) {
        expect(figure.querySelector("source")?.getAttribute("media")).toBe("(max-width: 767px)");
        const mobile = figure.querySelector("source")?.getAttribute("srcset");
        expect(capture.assets.some((asset) => asset.file === mobile)).toBe(true);
      }
    }
    for (const figure of figures) expect(figure.querySelector("img")?.getAttribute("loading")).toBe("lazy");
    expect(dom.body.textContent).toContain(capture.source.fileName);
    expect(dom.body.textContent).not.toContain("—");
    expect(dom.body.textContent).not.toMatch(/Supabase|Anthropic|OpenAI|OpenCode|Vercel|revolusioner|powered by AI/);
  });

  it("keeps the published intrinsic dimensions and bytes equal to each actual asset", async () => {
    for (const asset of capture.assets) {
      expect(asset.file).toMatch(/^\/product\/[a-z-]+\.webp$/);
      const bytes = await readFile(join(process.cwd(), "public", asset.file));
      const metadata = await sharp(bytes).metadata();
      expect(bytes.length).toBe(asset.bytes);
      expect(metadata.format).toBe("webp");
      expect(metadata.width).toBe(asset.width);
      expect(metadata.height).toBe(asset.height);
    }
  });
});
