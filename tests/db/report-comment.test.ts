import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { dateOnly } from "@/lib/format";
import { MockProvider, type AiProvider } from "@/lib/ai/provider";
import { clearReportComment, computedFacts, draftCommentary, noteForReport, reportComment, saveReportComment } from "@/lib/reports/report-comment";

// Catatan manajemen (I5b): AI rewords the computed sentences, arithmetic checks every number, the accountant approves.
type G = Awaited<ReturnType<typeof makeGroup>>;
let g: G;
beforeEach(async () => {
  await resetDb();
  g = await makeGroup();
});
const id = async (code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
async function sale(month: number, amount: bigint) {
  const lines = [{ accountId: g.pt.banks[0].accountId, debit: amount }, { accountId: await id("4100"), credit: amount }];
  await db.$transaction((tx) => postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, month, 10), kind: "ADJUSTMENT", memo: "jual", lines }));
}
const k = () => ({ clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month: 8 });
/** A provider whose draft invents a number. */
const inventing = (base: MockProvider): AiProvider => Object.assign(Object.create(base), { draftCommentary: async () => ({ text: "Pendapatan naik sekitar 10 % menjadi Rp 2 juta.", promptTokens: 10, completionTokens: 10, model: base.model }) });

describe("catatan manajemen", () => {
  it("drafts from the computed sentences only, checks its numbers, and caches the draft", async () => {
    await sale(7, 1_000_000n);
    await sale(8, 1_250_000n);
    const facts = await computedFacts(db, k());
    expect(facts[0]).toBe("Pendapatan Agustus 2026 Rp 1.250.000, naik Rp 250.000 (25,0 %) dari Juli 2026.");
    const provider = new MockProvider();
    const d = await draftCommentary(db, { ...k(), firmId: g.firm.id, provider });
    expect(d.text).toContain("Rp 1.250.000");
    expect(d.foreign).toEqual([]);
    await draftCommentary(db, { ...k(), firmId: g.firm.id, provider });
    expect(provider.calls).toBe(1);
    const bad = await draftCommentary(db, { ...k(), month: 8, firmId: g.firm.id, provider: inventing(new MockProvider({}, "other-model")) });
    expect(bad.foreign).toEqual(["10", "2"]);
  });

  it("refuses an AI note with a foreign number, allows the accountant's with a warning, and goes stale when the books move", async () => {
    await sale(8, 1_250_000n);
    const facts = await computedFacts(db, k());
    await expect(saveReportComment(db, { ...k(), firmId: g.firm.id, text: "Pendapatan Rp 9.999.999.", source: "AI" })).rejects.toThrow(/angka yang tidak ada di laporan: 9\.999\.999/);
    expect(await saveReportComment(db, { ...k(), firmId: g.firm.id, text: "Pendapatan Rp 1.250.000; target tahun depan Rp 2.000.000.", source: "ACCOUNTANT" })).toEqual({ foreign: ["2.000.000"] });
    await saveReportComment(db, { ...k(), firmId: g.firm.id, text: facts.join(" "), source: "AI" });
    expect(await noteForReport(db, k())).toEqual({ lines: [facts.join(" ")], approved: true, staleNote: false });
    await sale(8, 50_000n);
    expect((await reportComment(db, k()))?.stale).toBe(true);
    const after = await noteForReport(db, k());
    expect(after.approved).toBe(false);
    expect(after.staleNote).toBe(true);
    expect(after.lines[0]).toContain("Rp 1.300.000");
    await clearReportComment(db, { ...k(), firmId: g.firm.id });
    expect(await reportComment(db, k())).toBeNull();
    expect(await db.auditEvent.count({ where: { kind: "REPORT_COMMENT" } })).toBe(3);
    await expect(saveReportComment(db, { ...k(), firmId: "other", text: "x", source: "ACCOUNTANT" })).rejects.toThrow(/tidak ditemukan/);
  });
});

describe("management workbook", () => {
  it("carries the approved note while it matches the books, and says so when it no longer does", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { managementWorkbook } = await import("@/lib/reports/management-pack");
    await sale(8, 1_250_000n);
    await saveReportComment(db, { ...k(), firmId: g.firm.id, text: "Bulan yang baik: pendapatan Rp 1.250.000.", source: "ACCOUNTANT" });
    const sheet = async () => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await managementWorkbook(db, { ...k(), meta: { firm: "KJA Uji", title: "PT Uji" } })) as unknown as ArrayBuffer);
      return wb.getWorksheet("Ringkasan")!.getSheetValues().flat().map(String).join(" | ");
    };
    expect(await sheet()).toMatch(/Catatan bulan ini \(disetujui akuntan\) \| Bulan yang baik: pendapatan Rp 1\.250\.000\./);
    await sale(8, 1_000n);
    const after = await sheet();
    expect(after).not.toContain("Bulan yang baik");
    expect(after).toMatch(/Catatan yang disetujui tidak dipakai/);
  });
});
