import "dotenv/config";
import { expect, test, type Route } from "@playwright/test";
import { Pool } from "pg";
import { makePdf } from "../tests/pdf-fixture";

/**
 * Synthetic evidence-only journey. The standard global setup seeds the disposable
 * E2E database; this spec compares journal counts rather than requiring empty books.
 * Run server and runner with EVIDENCE_ENABLED=true, DEMO_MODE=false and AI disabled.
 */
test.describe("document evidence workspace", () => {
  test.skip(process.env.EVIDENCE_ENABLED !== "true" || process.env.DEMO_MODE === "true", "Evidence workspace is enabled only for the private pilot.");
  let db: Pool;
  test.beforeAll(async () => {
    db = new Pool({ connectionString: process.env.DATABASE_URL });
    // Stop before submitting a question if deployment config could make a paid call.
    // The seed deliberately preserves AppSetting; never assume it cleared an AI key.
    expect(Boolean(process.env.AI_API_KEY && process.env.AI_MODEL), "Run E2E with AI_API_KEY='' AI_MODEL=''").toBe(false);
    const stored = await db.query<{ configured: boolean }>(`SELECT EXISTS(SELECT 1 FROM "AppSetting" WHERE key = 'ai.apiKey' AND value <> '') AS configured`);
    expect(stored.rows[0].configured, "The disposable E2E DB must not contain a stored AI key").toBe(false);
  });
  test.afterAll(async () => { await db?.end(); });

  test("uploads, pauses and resumes, answers before onboarding, preserves sources and books on desktop/mobile", async ({ page }, testInfo) => {
    const firm = (await db.query<{ id: string }>(`SELECT id FROM "Firm" ORDER BY "createdAt" ASC LIMIT 1`)).rows[0];
    expect(firm, "Global setup must seed the same disposable database used by the server").toBeTruthy();
    const snapshot = async () => {
      // Table names are fixed test constants; every value remains parameterized.
      const counts = await Promise.all(["JournalEntry", "JournalLine", "Client", "AiUsage"].map(async table => (await db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM "${table}" WHERE "firmId" = $1`, [firm.id])).rows[0].count));
      return { entries: counts[0], lines: counts[1], clients: counts[2], paidCalls: counts[3] };
    };
    const intakeState = async (id: string) => (await db.query<{ status: string; leaseToken: string | null; clientId: string | null }>(`SELECT status, "leaseToken", "clientId" FROM "EvidenceIntake" WHERE id = $1 AND "firmId" = $2`, [id, firm.id])).rows[0];
    const documentCount = async (id: string, statuses: string[]) => (await db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM "EvidenceDocument" WHERE "firmId" = $1 AND "intakeId" = $2 AND status = ANY($3::text[])`, [firm.id, id, statuses])).rows[0].count;
    const before = await snapshot();
    const profile = [
      "Company profile",
      "Company name: Citra Ternak Holdings Pte. Ltd.",
      "Business activity: Poultry nutrition and farming",
      "Currency: USD",
    ].join("\n");
    const report = (year: number, amount: string) => [
      "Citra Ternak Holdings Pte. Ltd.",
      "Financial statements",
      `Year ended 31 January ${year}`,
      "Amounts in USD",
      `Revenue: ${amount}`,
    ].join("\n");
    const file = (name: string, text: string) => ({ name, mimeType: "text/plain", buffer: Buffer.from(text) });

    await page.goto("/documents");
    await expect(page.getByRole("heading", { name: "Dokumen", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Tambahkan dokumen" }).click();
    await expect(page).toHaveURL(/\/documents\/[^/?]+$/);
    const workspaceUrl = page.url();
    const intakeId = new URL(workspaceUrl).pathname.split("/").at(-1)!;
    await expect(page.getByText("Unggah file atau tempel tautan Drive", { exact: true })).toBeVisible();

    // Real actions remain real; small network latency makes the pause interaction
    // observable even when tiny synthetic files process faster than a human click.
    const delayActions = async (route: Route) => {
      if (route.request().method() === "POST" && route.request().headers()["next-action"]) await new Promise(resolve => setTimeout(resolve, 200));
      await route.continue();
    };
    await page.route("**/documents/**", delayActions);
    await page.getByLabel("File dokumen").setInputFiles([
      file("evidence-company-profile.txt", profile),
      file("evidence-report-2023.txt", report(2023, "1000.00")),
      file("evidence-report-2024.txt", report(2024, "1250.00")),
      { name: "evidence-scan.pdf", mimeType: "application/pdf", buffer: makePdf([[]]) },
      { name: "evidence-legacy.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("Synthetic unsupported Office document") },
    ]);
    const pause = page.getByRole("button", { name: "Jeda setelah langkah ini" });
    await expect(pause).toBeVisible();
    await expect(page.getByTestId("next-step")).toContainText("Menutup halaman menjeda proses");
    await pause.click();
    await expect(page.getByRole("button", { name: "Lanjutkan pemeriksaan" })).toBeVisible();
    // Pausing permits the active step to finish. Wait for its persisted result,
    // then verify a following file remains queued rather than assuming cancellation.
    await expect.poll(() => documentCount(intakeId, ["READY", "ERROR"])).toBeGreaterThan(0);
    await expect.poll(async () => (await intakeState(intakeId)).leaseToken).toBeNull();
    const waiting = await documentCount(intakeId, ["PENDING"]);
    expect(waiting).toBeGreaterThan(0);
    await page.goto("/documents");
    await page.goto(workspaceUrl);
    // Returning resumes queued steps automatically; the explicit pause applied to
    // the previous visit, while persisted completed steps are not repeated.
    await expect(page.getByRole("button", { name: "Jeda setelah langkah ini" })).toBeVisible();
    await expect.poll(async () => (await intakeState(intakeId)).status, { timeout: 30_000 }).toBe("DONE");
    await expect(page.getByRole("status").filter({ hasText: "Pemeriksaan selesai" })).toBeVisible();
    expect(await documentCount(intakeId, ["READY"])).toBe(3);
    expect(await documentCount(intakeId, ["ERROR"])).toBe(2);

    const scan = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "evidence-scan.pdf" }) });
    await expect(scan.getByRole("alert")).toContainText("OCR belum didukung");
    await expect(scan.getByRole("button", { name: "Coba kembali" })).toBeVisible();
    const office = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "evidence-legacy.docx" }) });
    await expect(office.getByRole("alert")).toContainText("Ekspor sebagai PDF");

    await page.locator("summary").filter({ hasText: "evidence-report-2024.txt" }).click();
    await expect(page.getByLabel("Mata uang evidence-report-2024.txt", { exact: true })).toHaveValue("USD");
    await expect(page.getByLabel("Dari evidence-report-2024.txt", { exact: true })).toHaveValue("2023-02-01");
    await expect(page.getByLabel("Sampai evidence-report-2024.txt", { exact: true })).toHaveValue("2024-01-31");
    await page.getByRole("button", { name: "Periksa usulan klien baru" }).click();
    await expect(page.getByLabel("Nama lengkap")).toHaveValue("Citra Ternak Holdings Pte. Ltd.");
    await expect(page.getByRole("combobox", { name: "Jenis entitas" })).toContainText("Badan usaha asing");
    await page.getByLabel("Nama klien").fill("Grup Citra Ternak");
    await expect(page.getByLabel("Nama lengkap")).toHaveValue("Citra Ternak Holdings Pte. Ltd.");
    await page.getByRole("button", { name: "Periksa usulan klien baru" }).click();

    await page.getByLabel("Pertanyaan", { exact: true }).fill("Bandingkan Revenue");
    await page.getByRole("button", { name: "Tanyakan", exact: true }).click();
    await expect(page.getByText(/Perbandingan angka yang dilaporkan dokumen/).first()).toBeVisible();
    await expect(page.getByText(/perubahan US\$ 250,00/).first()).toBeVisible();
    expect((await intakeState(intakeId)).clientId).toBeNull();
    await expect(page.getByRole("button", { name: "Tanyakan", exact: true })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath("evidence-workspace-desktop.png"), fullPage: true });

    const citation = page.getByRole("link", { name: /evidence-report-2024\.txt.*baris 5/ }).first();
    await expect(citation).toBeVisible();
    const citationHref = await citation.getAttribute("href");
    expect(citationHref).toMatch(/\/documents\/source\/.+\?at=baris%205/);
    await citation.click();
    await expect(page.getByRole("heading", { name: "evidence-report-2024.txt", exact: true, level: 1 })).toBeVisible();
    await expect(page.getByText("Revenue: 1250.00", { exact: true })).toBeVisible();
    await expect(page.getByText("Lokasi rujukan:")).toContainText("baris 5");
    await page.screenshot({ path: testInfo.outputPath("evidence-source-desktop.png"), fullPage: true });
    await page.getByRole("link", { name: "Kembali ke dokumen" }).click();
    await page.getByLabel("Pertanyaan", { exact: true }).fill("Cari Poultry");
    await page.getByRole("button", { name: "Tanyakan", exact: true }).click();
    await expect(page.getByText(/Kutipan dokumen yang cocok/).first()).toBeVisible();
    await expect(page.getByText("Business activity: Poultry nutrition and farming", { exact: true }).first()).toBeVisible();

    await expect(page.getByRole("button", { name: "Tanyakan", exact: true })).toBeEnabled();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel("Pertanyaan", { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("evidence-workspace-mobile.png"), fullPage: true });
    await page.goto(citationHref!);
    await expect(page.getByText("Revenue: 1250.00", { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("evidence-source-mobile.png"), fullPage: true });

    // Upload, extraction and questions created neither clients nor book entries,
    // and the source version is immutable even after repeated reads.
    expect(await snapshot()).toEqual(before);
    const storedProfile = await db.query<{ data: Buffer }>(`SELECT v.data FROM "EvidenceVersion" v JOIN "EvidenceDocument" d ON d.id = v."documentId" WHERE v."firmId" = $1 AND d."intakeId" = $2 AND v.name = $3`, [firm.id, intakeId, "evidence-company-profile.txt"]);
    expect(storedProfile.rows[0].data.toString("utf8")).toBe(profile);
    const messages = await db.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM "EvidenceMessage" WHERE "firmId" = $1 AND "intakeId" = $2`, [firm.id, intakeId]);
    expect(messages.rows[0].count).toBe(2);
  });
});
