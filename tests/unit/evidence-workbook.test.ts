import { describe, expect, it } from "vitest";
import { detectTables, readSheets } from "@/lib/ledger-import/read";
import { groupWorkbook, POSTABLE } from "../evidence-workbook-fixture";

describe("group reconciliation workbook fixture", () => {
  it("has exactly three postable tables for the manual ledger import", async () => {
    const tables = detectTables(await readSheets("group.xlsx", await groupWorkbook()));
    expect(tables.map((t) => [t.sheet, t.mode])).toEqual([[POSTABLE.neraca, "NERACA"], [POSTABLE.holdco, "LEDGER"], [POSTABLE.opco, "LEDGER"]]);
  });
});
