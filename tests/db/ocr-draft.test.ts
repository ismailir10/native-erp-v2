import { beforeEach, describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { db, makeGroup, resetDb } from "../helpers";
import { MockProvider } from "@/lib/ai/provider";
import { encodePng } from "@/lib/ocr/png";
import { createOcrDraft, draftCsv, importOcrDraft, ocrDraft, setOcrEnabled, updateOcrDraft } from "@/lib/ocr/draft";
import { runControls } from "@/lib/controls";
import { statementCoverage, statementEvidence } from "@/lib/controls/coverage";
import { readValidation } from "@/lib/import/validation";
import type { OcrTranscript } from "@/lib/ocr/transcribe";

// Scanned statements (I2a): AI transcribes (a recorded extraction here), the running balance proves, the accountant fixes and imports.
type G = Awaited<ReturnType<typeof makeGroup>>;
let g: G;
let scan: Buffer;
beforeEach(async () => {
  await resetDb();
  g = await makeGroup();
  scan = await new Promise<Buffer>((resolve) => {
    const doc = new PDFDocument();
    const parts: Buffer[] = [];
    doc.on("data", (b: Buffer) => parts.push(b));
    doc.on("end", () => resolve(Buffer.concat(parts)));
    doc.image(encodePng(30, 30, 1, new Uint8Array(900).fill(200)), 20, 20, { width: 500 });
    doc.end();
  });
});

const RECORDED: OcrTranscript = {
  bank: "BCA",
  accountNumber: "111-111-1111",
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
  opening: "1.000.000,00",
  closing: "1.250.000,00",
  rows: [
    { date: "2026-08-03", description: "SETORAN TUNAI", debit: "", credit: "500.000,00", balance: "1.500.000,00" },
    { date: "2026-08-05", description: "BIAYA ADMIN", debit: "100.000,00", credit: "", balance: "1.490.000,00" }, // misread: printed 10.000,00
    { date: "2026-08-10", description: "TRANSFER KE PT MAJU", debit: "240.000,00", credit: "", balance: "1.250.000,00" },
  ],
};
const mock = (t: OcrTranscript | null = RECORDED) => Object.assign(new MockProvider({}, "mock-vision"), { ocrTranscript: t });
const base = () => ({ firmId: g.firm.id, clientId: g.client.id, bankAccountId: g.pt.banks[0].id, fileName: "bca-agustus-scan.pdf", data: scan });

describe("OCR draft", () => {
  it("is refused while the firm switch is off, and for another firm", async () => {
    await expect(createOcrDraft(db, { ...base(), provider: mock() })).rejects.toThrow(/belum diaktifkan/);
    await setOcrEnabled(db, true);
    await expect(createOcrDraft(db, { ...base(), firmId: "other", provider: mock() })).rejects.toThrow(/Rekening tidak ditemukan/);
    await expect(createOcrDraft(db, { ...base(), provider: null })).rejects.toThrow(/AI belum diatur/);
  });

  it("proves the transcription, refuses import while a row does not tie, imports after the fix through the normal pipeline", async () => {
    await setOcrEnabled(db, true);
    const provider = mock();
    const created = await createOcrDraft(db, { ...base(), provider });
    let d = await ocrDraft(db, g.firm.id, g.client.id, created.id);
    expect(d.proof.rows.map((r) => r.state)).toEqual(["OK", "BREAK", "OK"]);
    expect(d.proof.rows[1].expected).toBe(1_400_000n);
    expect(d).toMatchObject({ opening: 1_000_000n, closing: 1_250_000n, pages: 1 });
    await expect(importOcrDraft(db, { firmId: g.firm.id, clientId: g.client.id, draftId: d.id, provider: null })).rejects.toThrow(/1 baris yang belum terbukti/);

    const rows = d.rows.map((r) => ({ date: r.date, description: r.description, debit: r.debit?.toString() ?? "", credit: r.credit?.toString() ?? "", balance: r.balance?.toString() ?? "" }));
    rows[1].debit = "10.000";
    d = await updateOcrDraft(db, { firmId: g.firm.id, clientId: g.client.id, draftId: d.id, rows, opening: "1.000.000", closing: "1.250.000" });
    expect(d.proof).toMatchObject({ importable: true, problems: 0, closingOk: true });

    const summary = await importOcrDraft(db, { firmId: g.firm.id, clientId: g.client.id, draftId: d.id, provider: null });
    expect(summary).toMatchObject({ rows: 3, duplicates: 0, continuityOk: true });
    expect(summary.notes.join(" ")).toMatch(/Dibaca AI \(mock-vision\) dari scan 1 halaman; setiap baris terbukti oleh saldo berjalan/);
    const imp = await db.statementImport.findUniqueOrThrow({ where: { id: summary.importId } });
    expect(imp).toMatchObject({ fileName: "bca-agustus-scan (OCR).csv", openingBalance: 1_000_000n, closingBalance: 1_250_000n });
    const txs = await db.bankTransaction.findMany({ where: { importId: imp.id }, orderBy: { rowNumber: "asc" } });
    expect(txs.map((t) => t.amount)).toEqual([500_000n, -10_000n, -240_000n]);
    expect((await ocrDraft(db, g.firm.id, g.client.id, d.id)).status).toBe("IMPORTED");
    await expect(importOcrDraft(db, { firmId: g.firm.id, clientId: g.client.id, draftId: d.id, provider: null })).rejects.toThrow(/sudah diimpor/);

    // The same scan again: the transcription is served from the cache (no second call); a scan of September with no printed
    // opening takes the opening from the last imported closing balance, never from the model.
    await createOcrDraft(db, { ...base(), provider });
    expect(provider.calls).toBe(1);
    const sept = mock({ ...RECORDED, periodStart: "2026-09-01", periodEnd: "2026-09-30", opening: "", closing: "", rows: [{ date: "2026-09-02", description: "SETORAN", debit: "", credit: "50.000,00", balance: "1.300.000,00" }] });
    const s = await ocrDraft(db, g.firm.id, g.client.id, (await createOcrDraft(db, { ...base(), fileName: "sept.pdf", data: Buffer.concat([scan, Buffer.from("\n%sept")]), provider: sept })).id);
    expect(s.opening).toBe(1_250_000n);
    expect(s.header.openingSource).toBe("PREVIOUS");
    expect(s.proof.importable).toBe(false);
    const before = await db.journalEntry.count();
    await expect(importOcrDraft(db, { firmId: g.firm.id, clientId: g.client.id, draftId: s.id, provider: null })).rejects.toThrow(/Saldo akhir/);
    expect(await db.journalEntry.count()).toBe(before);
  });

  it("does not treat an expanded model period as reviewed full-month coverage", async () => {
    await setOcrEnabled(db, true);
    // Only August 3 has a transcribed row; the model expands the invisible header to all of August.
    const transcript: OcrTranscript = {
      ...RECORDED, periodStart: "2026-08-01", periodEnd: "2026-08-31",
      opening: "1.000.000,00", closing: "1.500.000,00", rows: [RECORDED.rows[0]],
    };
    const created = await createOcrDraft(db, { ...base(), provider: mock(transcript) });
    const draft = await ocrDraft(db, g.firm.id, g.client.id, created.id);
    expect(draft.proof.importable).toBe(true);
    const summary = await importOcrDraft(db, { firmId: g.firm.id, clientId: g.client.id, draftId: draft.id, provider: null });
    const imported = await db.statementImport.findUniqueOrThrow({ where: { id: summary.importId } });
    // Retain the transcribed header for traceability, without claiming that its coverage was checked by the accountant.
    expect(imported.periodEnd.toISOString().slice(0, 10)).toBe("2026-08-31");
    const validation = readValidation(imported.sourceValidation)!;
    expect(validation.source.period).toBe("INFERRED");
    expect(validation.issues).toContainEqual(expect.objectContaining({ code: "PERIOD_INFERRED", severity: "UNVERIFIED" }));
    const end = new Date("2026-08-31T00:00:00Z");
    const coverage = await statementCoverage(db, g.pt.banks[0].id, null, new Date("2026-08-01T00:00:00Z"), end);
    expect(coverage.state).toBe("partial");
    const evidence = statementEvidence([imported], end, null);
    expect(evidence.uncertain).toBe(true);
    expect(evidence.checkpoint).toBeUndefined();
    const controls = await runControls(db, g.client.id, 2026, 8);
    expect(controls.find((c) => c.key === `bank:${g.pt.banks[0].id}`)?.status).toBe("REVIEW");
    expect(controls.find((c) => c.key === `cont:${g.pt.banks[0].id}`)?.status).toBe("REVIEW");
  });

  it.each([
    ["foreign currency", { ...RECORDED, currency: "USD", opening: "10.50" }, /USD/],
    ["oversized response", { ...RECORDED, rows: Array(2001).fill(RECORDED.rows[0]) }, /2.000/],
    ["malformed row", { ...RECORDED, rows: [null] }, /Baris 1/],
    ["malformed amount", { ...RECORDED, rows: [{ ...RECORDED.rows[0], credit: "12,34,56" }] }, /tidak terbaca/],
  ] as const)("refuses %s before storing a draft, cache or journal", async (_name, transcript, error) => {
    await setOcrEnabled(db, true);
    await expect(createOcrDraft(db, { ...base(), provider: mock(transcript as unknown as OcrTranscript) })).rejects.toThrow(error);
    expect(await db.ocrDraft.count()).toBe(0);
    expect(await db.evidenceAiCache.count()).toBe(0);
    expect(await db.statementImport.count()).toBe(0);
    expect(await db.bankTransaction.count()).toBe(0);
    expect(await db.journalEntry.count()).toBe(0);
  });

  it("refuses dual-sided corrections even when their net movement ties to every printed balance", async () => {
    await setOcrEnabled(db, true);
    const created = await createOcrDraft(db, { ...base(), provider: mock() });
    const d = await updateOcrDraft(db, {
      firmId: g.firm.id, clientId: g.client.id, draftId: created.id,
      opening: "1.000.000", closing: "1.500.000",
      rows: [{ date: "2026-08-03", description: "SETORAN", debit: "100.000", credit: "600.000", balance: "1.500.000" }],
    });
    expect(d.proof.rows[0].state).toBe("BAD_AMOUNT");
    expect(d.proof.importable).toBe(false);
    await expect(importOcrDraft(db, { firmId: g.firm.id, clientId: g.client.id, draftId: d.id, provider: null })).rejects.toThrow(/belum terbukti/);
    expect(await db.statementImport.count()).toBe(0);
    expect(await db.bankTransaction.count()).toBe(0);
    expect(await db.journalEntry.count()).toBe(0);
    expect((await db.ocrDraft.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("DRAFT");
  });

  it("refuses a scan of another account, and builds the CSV the generic parser reads", async () => {
    await setOcrEnabled(db, true);
    await expect(createOcrDraft(db, { ...base(), provider: mock({ ...RECORDED, accountNumber: "9999999999" }) })).rejects.toThrow(/Nomor rekening di scan \(9999999999\) berbeda/);
    expect(draftCsv([{ date: "2026-08-03", description: "SETOR; TUNAI", debit: null, credit: 500_000n, balance: 1_500_000n }], 1_000_000n)).toBe(
      "Tanggal;Keterangan;Debet;Kredit;Saldo\n03/08/2026;SALDO AWAL;;;1.000.000,00\n03/08/2026;SETOR TUNAI;;500.000,00;1.500.000,00\n",
    );
  });
});
