import { describe, expect, it } from "vitest";
import { extractEvidence } from "@/lib/evidence/extract";
import { detectTables, readSheets } from "@/lib/ledger-import/read";
import { groupWorkbook, POSTABLE } from "../evidence-workbook-fixture";

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

  it("never reads a column header or a status as a company name", async () => {
    const { units } = await extractEvidence("group.xlsx", await groupWorkbook());
    expect(units.map((u) => u.entity).filter(Boolean)).toEqual([]);
    expect(units.flatMap((u) => u.facts.filter((f) => f.key === "companyName"))).toEqual([]);
  });
});
