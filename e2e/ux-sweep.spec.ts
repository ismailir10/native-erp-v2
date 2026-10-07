import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

/**
 * Usability sweep (`npm run ux:sweep`, not part of the default e2e run): every firm and client page of the three demo clients at
 * 1440 px and 390 px. Records HTTP errors, console errors, page-level horizontal scroll, scroll inside cards on phones, missing or
 * doubled NextStep banners, "undefined"/"NaN" in text and broken internal links into `findings.json`, with screenshots beside it
 * (UX_OUT, default .playwright/ux). A finding is a lead to look at, not a failure: wide tables are meant to scroll inside their card.
 */
const OUT = process.env.UX_OUT ?? ".playwright/ux";
mkdirSync(OUT, { recursive: true });
type Finding = { page: string; width: number; issue: string };
const findings: Finding[] = [];
const CLIENTS = ["Grup Ayam Nusantara", "CV Sinar Retail", "PT Jasa Kreatif Digital"];
const CLIENT_ROUTES = ["", "/import", "/opening", "/review", "/ledger", "/trial-balance", "/journals/new", "/close", "/reports", "/reports?tab=bs", "/reports?tab=cf", "/reports?tab=notes", "/reports?tab=mgmt", "/tax/masa", "/tax", "/assets", "/receivables", "/inventory", "/leases", "/benefits", "/settings", "/history", "/rates", "/documents"];
const FIRM_ROUTES = ["/", "/documents", "/reports", "/settings", "/clients/new", "/work"];

async function check(page: Page, path: string, width: number, shot: string | null) {
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  const errors: string[] = [];
  const onConsole = (m: import("@playwright/test").ConsoleMessage) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); };
  const onPageError = (e: Error) => errors.push(`pageerror: ${e.message.slice(0, 200)}`);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  const res = await page.goto(path, { waitUntil: "networkidle" }).catch((e) => { findings.push({ page: path, width, issue: `goto failed: ${e}` }); return null; });
  if (res && res.status() >= 400) findings.push({ page: path, width, issue: `HTTP ${res.status()}` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) findings.push({ page: path, width, issue: `horizontal page scroll ${overflow}px` });
  if (width < 500) {
    const inner = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll("body *")) as HTMLElement[]) {
        const cs = getComputedStyle(el);
        if (!["auto", "scroll", "hidden"].includes(cs.overflowX) || el.clientWidth === 0) continue;
        const over = el.scrollWidth - el.clientWidth;
        if (over > 4) {
          const card = el.closest("[data-testid]")?.getAttribute("data-testid") ?? "";
          const head = (el.closest("[data-slot=card]") ?? el).querySelector("[data-slot=card-title], h1, h2, h3")?.textContent?.slice(0, 40) ?? "";
          out.push(`${el.tagName.toLowerCase()} +${over}px ${card ? `[${card}]` : ""} ${head}`.trim());
        }
      }
      return [...new Set(out)].slice(0, 6);
    });
    for (const i of inner) findings.push({ page: path, width, issue: `inner scroll: ${i}` });
  }
  const nextSteps = await page.getByTestId("next-step").count();
  if (nextSteps === 0 && !/\/clients\/new|\/work|\/history|\/settings$|\/rates/.test(path)) findings.push({ page: path, width, issue: "no NextStep banner" });
  if (nextSteps > 1) findings.push({ page: path, width, issue: `${nextSteps} NextStep banners` });
  const bodyText = await page.locator("body").innerText();
  for (const bad of ["undefined", "NaN", "[object Object]", "Infinity", "null "]) if (bodyText.includes(bad)) findings.push({ page: path, width, issue: `text contains "${bad}"` });
  if (/Terjadi kesalahan|Application error|Unhandled Runtime/.test(bodyText)) findings.push({ page: path, width, issue: "error text on page" });
  for (const e of errors.filter((x) => !/favicon|Download the React DevTools/.test(x))) findings.push({ page: path, width, issue: `console: ${e}` });
  if (shot) await page.screenshot({ path: `${OUT}/${shot}-${width}.png`, fullPage: true });
  page.off("console", onConsole);
  page.off("pageerror", onPageError);
}

test("ux sweep", async ({ page }) => {
  test.setTimeout(30 * 60_000);
  for (const r of FIRM_ROUTES) for (const w of [1440, 390]) await check(page, r, w, `firm${r.replace(/\W+/g, "_") || "_home"}`);
  await page.goto("/");
  const ids: Record<string, string> = {};
  for (const name of CLIENTS) {
    const href = await page.getByRole("link", { name, exact: true }).first().getAttribute("href");
    ids[name] = href!.match(/clients\/([^/?]+)/)![1];
  }
  for (const [name, id] of Object.entries(ids)) {
    const short = name.split(" ").slice(0, 2).join("_");
    for (const r of CLIENT_ROUTES) {
      const sep = r.includes("?") ? "&" : "?";
      const path = `/clients/${id}${r}${sep}period=2026-08`;
      for (const w of [1440, 390]) await check(page, path, w, name === CLIENTS[0] || r === "" ? `${short}${r.replace(/\W+/g, "_") || "_overview"}` : null);
    }
  }
  // Every internal link on the client overview and Beranda must resolve.
  const seen = new Set<string>();
  for (const start of ["/", `/clients/${ids[CLIENTS[0]]}?period=2026-08`, `/clients/${ids[CLIENTS[0]]}/close?period=2026-08`, `/clients/${ids[CLIENTS[0]]}/reports?period=2026-08`]) {
    await page.goto(start);
    const hrefs = await page.locator("a[href^='/']").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!));
    for (const h of hrefs) {
      if (seen.has(h) || /\/export|\/demo\/|logout/.test(h)) continue;
      seen.add(h);
      const r = await page.request.get(h);
      if (r.status() >= 400) findings.push({ page: `${start} → ${h}`, width: 1440, issue: `broken link ${r.status()}` });
    }
  }
  writeFileSync(`${OUT}/findings.json`, JSON.stringify({ ids, findings }, null, 2));
  expect(true).toBe(true);
});
