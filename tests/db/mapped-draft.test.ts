import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { createMappedDraft, importOcrDraft, ocrDraft } from "@/lib/ocr/draft";
import { proveRows } from "@/lib/ocr/prove";
import { importStatement } from "@/lib/import/pipeline";
import { readGrid } from "@/lib/import/grid";
import { suggestMapping, type ColumnMapping } from "@/lib/import/mapped";
import { ParseError } from "@/lib/import/types";
import { createFirm } from "@/lib/setup";
import { CLOSE, OPEN } from "../bank-fixture";
import { unknownCsv, unknownPdf } from "../unknown-layout";

const mappingOf = async (data: Buffer, over: Partial<ColumnMapping> = {}) => ({ ...suggestMapping(await readGrid(data)), ...over });

describe("Atur kolom: a file the readers refuse, read with the accountant's mapping into Periksa baris", () => {
  beforeEach(resetDb);

  it("proves every row, imports through the normal pipeline without AI, and remembers the layout for the firm", async () => {
    const g = await makeGroup();
    const bank = g.pt.banks[0];
    const data = unknownCsv();
    await expect(importStatement(db, { bankAccountId: bank.id, fileName: "kas-agustus.csv", data, provider: null })).rejects.toThrow(ParseError);

    const draft = await createMappedDraft(db, { firmId: g.firm.id, clientId: g.client.id, bankAccountId: bank.id, fileName: "kas-agustus.csv", data, mapping: await mappingOf(data, { description: [2] }) });
    const view = await ocrDraft(db, g.firm.id, g.client.id, draft.id);
    expect(view.source).toBe("MAPPING");
    expect(view.opening).toBe(BigInt(OPEN));
    expect(view.rows).toHaveLength(5);
    expect(view.rows[0]).toMatchObject({ date: "2026-08-01", description: "TRSF E-BANKING CR 0108/FTSCY/WS95031 PT MITRA UNGGAS FIKTIF", credit: 55_500_000n, debit: null });
    expect(view.proof.importable).toBe(true);
    expect(await db.statementLayout.count()).toBe(0); // remembered only once imported

    const summary = await importOcrDraft(db, { firmId: g.firm.id, clientId: g.client.id, draftId: draft.id, provider: null });
    expect(summary.rows).toBe(5);
    expect(summary.continuityOk).toBe(true);
    expect(summary.notes).toContain("Dibaca dengan pemetaan kolom; setiap baris terbukti oleh saldo berjalan.");
    const imp = await db.statementImport.findUniqueOrThrow({ where: { id: summary.importId } });
    expect(imp.fileName).toBe("kas-agustus (pemetaan kolom).csv");
    expect(imp.closingBalance).toBe(BigInt(CLOSE));

    const layouts = await db.statementLayout.findMany();
    expect(layouts).toHaveLength(1);
    expect(layouts[0]).toMatchObject({ firmId: g.firm.id, kind: "CSV", label: "kas-agustus.csv" });
    expect(layouts[0].mapping).toEqual({ date: 0, description: [2], amount: { style: "split", debit: 3, credit: 4 }, balance: 5, order: "DMY" });
    expect((await ocrDraft(db, g.firm.id, g.client.id, draft.id)).status).toBe("IMPORTED");
  });

  it("reads a text PDF the same way", async () => {
    const g = await makeGroup();
    const data = unknownPdf();
    const draft = await createMappedDraft(db, { firmId: g.firm.id, clientId: g.client.id, bankAccountId: g.pt.banks[0].id, fileName: "kas.pdf", data, mapping: await mappingOf(data) });
    const view = await ocrDraft(db, g.firm.id, g.client.id, draft.id);
    expect(view.pages).toBe(1);
    // No "Saldo awal" row and no earlier import: the opening is derived, and said so.
    expect(view.header.openingSource).toBe("DERIVED");
    expect(view.proof.importable).toBe(true);
    const summary = await importOcrDraft(db, { firmId: g.firm.id, clientId: g.client.id, draftId: draft.id, provider: null });
    expect(summary.continuityOk).toBe(true);
    expect((await db.statementLayout.findFirstOrThrow()).kind).toBe("PDF");
  });

  it("proves rows without a printed balance by the next one (a bank printing the balance once a day), and breaks the stretch when it doesn't tie", async () => {
    const g = await makeGroup();
    const csv = (lastBalance: string) =>
      Buffer.from(["Value Dt;Particulars;Withdrawn;Lodged;Position", "01/08/2026;SALDO AWAL;;;10.000.000", "01/08/2026;SETOR;;1.000.000;", "01/08/2026;BIAYA;5.000;;", `01/08/2026;BUNGA;;2.000;${lastBalance}`, "02/08/2026;TARIK;100.000;;10.897.000", ""].join("\n"));
    const mapping: ColumnMapping = { sheet: null, firstRow: 2, date: 0, description: [1], amount: { style: "split", debit: 2, credit: 3 }, balance: 4, order: "DMY", year: null };
    const ok = await createMappedDraft(db, { firmId: g.firm.id, clientId: g.client.id, bankAccountId: g.pt.banks[0].id, fileName: "a.csv", data: csv("10.997.000"), mapping });
    const view = await ocrDraft(db, g.firm.id, g.client.id, ok.id);
    expect(view.opening).toBe(10_000_000n);
    expect(view.proof.rows.map((r) => r.state)).toEqual(["OK", "OK", "OK", "OK"]);
    expect(view.proof.importable).toBe(true);
    const summary = await importOcrDraft(db, { firmId: g.firm.id, clientId: g.client.id, draftId: ok.id, provider: null });
    expect([summary.rows, summary.continuityOk]).toEqual([4, true]);

    // A misread amount inside the stretch: every row up to the printed balance is flagged, not just the last.
    const bad = await createMappedDraft(db, { firmId: g.firm.id, clientId: g.client.id, bankAccountId: g.pt.banks[1].id, fileName: "b.csv", data: csv("10.998.000"), mapping });
    const badView = await ocrDraft(db, g.firm.id, g.client.id, bad.id);
    expect(badView.proof.rows.map((r) => r.state)).toEqual(["BREAK", "BREAK", "BREAK", "BREAK"]);
    expect(badView.proof.importable).toBe(false);
  });

  it("opens from the account's last imported closing when the file prints no Saldo awal, so a misread first row breaks", async () => {
    const g = await makeGroup();
    const bank = g.pt.banks[0];
    const july = await createMappedDraft(db, { firmId: g.firm.id, clientId: g.client.id, bankAccountId: bank.id, fileName: "juli.csv", data: unknownCsv(7), mapping: await mappingOf(unknownCsv(7), { description: [2] }) });
    await importOcrDraft(db, { firmId: g.firm.id, clientId: g.client.id, draftId: july.id, provider: null });
    // August's PDF prints no Saldo awal; its first amount misread (55.500.000 → 55.000.000) with the printed balance kept.
    const pdf = unknownPdf(8);
    const august = await createMappedDraft(db, { firmId: g.firm.id, clientId: g.client.id, bankAccountId: bank.id, fileName: "agustus.pdf", data: pdf, mapping: await mappingOf(pdf) });
    const view = await ocrDraft(db, g.firm.id, g.client.id, august.id);
    expect(view.header.openingSource).toBe("PREVIOUS");
    expect(view.opening).toBe(BigInt(OPEN));
    expect(view.proof.importable).toBe(true);
    const misread = view.rows.map((r, i) => (i === 0 ? { ...r, credit: 55_000_000n } : r));
    expect(proveRows(misread, view.opening, null, { chained: true }).rows[0].state).toBe("BREAK");
  });

  it("leaves a day without a printed balance unproved: a Saldo column that is mostly empty can't prove the file", async () => {
    const g = await makeGroup();
    const data = Buffer.from(["Value Dt;Particulars;Withdrawn;Lodged;Position", "01/08/2026;SALDO AWAL;;;10.000.000", "01/08/2026;SETOR;;1.000.000;", "02/08/2026;BIAYA;5.000;;", "03/08/2026;BUNGA;;2.000;10.997.000", ""].join("\n"));
    const mapping: ColumnMapping = { sheet: null, firstRow: 2, date: 0, description: [1], amount: { style: "split", debit: 2, credit: 3 }, balance: 4, order: "DMY", year: null };
    const draft = await createMappedDraft(db, { firmId: g.firm.id, clientId: g.client.id, bankAccountId: g.pt.banks[0].id, fileName: "a.csv", data, mapping });
    const view = await ocrDraft(db, g.firm.id, g.client.id, draft.id);
    expect(view.proof.rows.map((r) => r.state)).toEqual(["NO_BALANCE", "NO_BALANCE", "OK"]);
    expect(view.proof.importable).toBe(false);
  });

  it("refuses a file too long for one draft before the draft exists", async () => {
    const g = await makeGroup();
    let b = 10_000_000;
    const rows = Array.from({ length: 2001 }, (_, i) => `01/08/2026;SETOR ${i};;1.000;${(b += 1000)}`);
    const data = Buffer.from(["Value Dt;Particulars;Withdrawn;Lodged;Position", ...rows, ""].join("\n"));
    const mapping: ColumnMapping = { sheet: null, firstRow: 2, date: 0, description: [1], amount: { style: "split", debit: 2, credit: 3 }, balance: 4, order: "DMY", year: null };
    await expect(createMappedDraft(db, { firmId: g.firm.id, clientId: g.client.id, bankAccountId: g.pt.banks[0].id, fileName: "a.csv", data, mapping })).rejects.toThrow("File ini berisi 2.001 transaksi; Periksa baris menampung paling banyak 2.000.");
    expect(await db.ocrDraft.count()).toBe(0);
  });

  it("doesn't remember a mapping of a file without a header row", async () => {
    const g = await makeGroup();
    const data = Buffer.from(["01/08/2026;SETOR;1.000.000;11.000.000", "02/08/2026;TARIK;-250.000;10.750.000", ""].join("\n"));
    const mapping: ColumnMapping = { sheet: null, firstRow: 1, date: 0, description: [1], amount: { style: "signed", column: 2, direction: null }, balance: 3, order: "DMY", year: null };
    const draft = await createMappedDraft(db, { firmId: g.firm.id, clientId: g.client.id, bankAccountId: g.pt.banks[0].id, fileName: "x.csv", data, mapping });
    await importOcrDraft(db, { firmId: g.firm.id, clientId: g.client.id, draftId: draft.id, provider: null });
    expect(await db.statementLayout.count()).toBe(0);
  });

  it("refuses another firm's bank account", async () => {
    const g = await makeGroup();
    const other = await createFirm(db, "KJA Lain");
    const data = unknownCsv();
    await expect(createMappedDraft(db, { firmId: other.id, clientId: g.client.id, bankAccountId: g.pt.banks[0].id, fileName: "x.csv", data, mapping: await mappingOf(data) })).rejects.toThrow(/Rekening tidak ditemukan/);
  });
});
