import { describe, expect, it } from "vitest";
import { extractEvidence } from "@/lib/evidence/extract";
import { detectTables, readSheets } from "@/lib/ledger-import/read";
import { ENGINE_ROWS, groupWorkbook, POSTABLE } from "../evidence-workbook-fixture";

describe("group reconciliation workbook fixture", () => {
  it("has exactly three postable tables for the manual ledger import", async () => {
    const tables = detectTables(await readSheets("group.xlsx", await groupWorkbook()));
    expect(tables.map((t) => [t.sheet, t.mode])).toEqual([[POSTABLE.neraca, "NERACA"], [POSTABLE.holdco, "LEDGER"], [POSTABLE.opco, "LEDGER"]]);
  });
});

describe("evidence extraction of a group workbook", () => {
  it("proposes only postable tables as sources and reads their coverage from rows", async () => {
    const { units } = await extractEvidence("group.xlsx", await groupWorkbook());
    const byKey = Object.fromEntries(units.map((u) => [u.key, u]));
    expect(units.filter((u) => u.role === "SOURCE").map((u) => u.key)).toEqual([POSTABLE.neraca, POSTABLE.holdco, POSTABLE.opco]);
    expect(units.filter((u) => u.kind === "BANK")).toEqual([]);
    expect(byKey[POSTABLE.neraca]).toMatchObject({ kind: "LEDGER", periodStart: null, periodEnd: null, table: { mode: "NERACA", rows: 3, entities: [], periodEnd: null } });
    expect(byKey[POSTABLE.neraca].issues).toContain("Tanggal neraca tidak tertulis di file; isi tanggalnya saat konfirmasi.");
    expect(byKey[POSTABLE.holdco]).toMatchObject({ kind: "LEDGER", periodStart: "2026-01-05", periodEnd: "2026-01-20", table: { mode: "LEDGER", rows: 4, entities: ["HOLDCO"] } });
    expect(byKey[POSTABLE.opco].table).toMatchObject({ mode: "LEDGER", rows: 8, entities: ["OPA", "OPB", "OPC", "OPD"], periodStart: "2026-01-10", periodEnd: "2026-01-10" });
    expect(byKey["11_HC_MOVEMENT_ENGINE"]).toMatchObject({ role: "CONTEXT" });
    expect(byKey["14_HC_TB_ENGINE"]).toMatchObject({ kind: "REPORT", role: "COMPARISON" });
  });

  it("summarises thousands of uncached formula cells as one line with a count and examples", async () => {
    const { units } = await extractEvidence("group.xlsx", await groupWorkbook());
    const engine = units.find((u) => u.key === "11_HC_MOVEMENT_ENGINE")!;
    const formula = engine.issues.filter((i) => i.includes("rumus"));
    expect(formula).toEqual([`${(ENGINE_ROWS * 4).toLocaleString("id-ID")} rumus belum memiliki hasil tersimpan (contoh: D3, E3, F3). Hitung ulang dan simpan di Excel.`]);
    expect(engine.issues.length).toBeLessThanOrEqual(20);
    expect(units.find((u) => u.key === POSTABLE.holdco)!.issues).toContain("4 rumus belum memiliki hasil tersimpan (contoh: M4, M5, M6). Hitung ulang dan simpan di Excel.");
  });

  it("caps a unit at 20 issue lines and counts the rest", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Errors");
    for (let i = 0; i < 30; i++) ws.addRow([`Row ${i}`, { error: `#E${i}` }]);
    const { units: [unit] } = await extractEvidence("errors.xlsx", Buffer.from(await wb.xlsx.writeBuffer()));
    expect(unit.issues).toHaveLength(20);
    expect(unit.issues.at(-1)).toMatch(/^Dan \d+ temuan lain\.$/);
  });

  it("never reads a column header or a status as a company name", async () => {
    const { units } = await extractEvidence("group.xlsx", await groupWorkbook());
    expect(units.map((u) => u.entity).filter(Boolean)).toEqual([]);
    expect(units.flatMap((u) => u.facts.filter((f) => f.key === "companyName"))).toEqual([]);
  });
});
