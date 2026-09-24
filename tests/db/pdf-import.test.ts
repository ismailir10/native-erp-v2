import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { makePdf, table } from "../pdf-fixture";
import { importStatement } from "@/lib/import/pipeline";

/** Mandiri e-statement for the test group's Mandiri Giro (2222222222), password-protected like real ones. */
const pdf = makePdf(
  [
    [
      ...table(800, [[[40, "PT Bank Mandiri (Persero) Tbk"]], [[40, "Nomor Rekening : 2222222222"]], [[40, "Periode : 01/08/2026 - 31/08/2026"]]]),
      ...table(740, [
        [[40, "Tanggal"], [130, "Keterangan"], [360, "Debit"], [440, "Kredit"], [520, "Saldo"]],
        [[40, "01/08/2026"], [130, "SALDO AWAL"], [510, "0,00"]],
        [[40, "04/08/2026"], [130, "TRANSFER DARI PT MITRA UNGGAS"], [430, "20.000.000,00"], [510, "20.000.000,00"]],
        [[40, "09/08/2026"], [130, "PEMBELIAN PAKAN AYAM"], [355, "4.440.000,00"], [510, "15.560.000,00"]],
      ]),
    ],
  ],
  { userPassword: "rahasia" },
);

describe("PDF import through the pipeline", () => {
  beforeEach(resetDb);

  it("posts PDF rows with their source line, and never stores the password", async () => {
    const g = await makeGroup();
    const bankAccountId = g.pt.banks[1].id;
    await expect(importStatement(db, { bankAccountId, fileName: "mandiri.pdf", data: pdf, provider: null })).rejects.toThrow(/kata sandi/);

    const s = await importStatement(db, { bankAccountId, fileName: "mandiri.pdf", data: pdf, provider: null, password: "rahasia" });
    expect(s).toMatchObject({ rows: 2, duplicates: 0, continuityOk: true });
    expect(s.byMethod.RULE).toBe(1); // "PAKAN" rule from makeGroup

    const txs = await db.bankTransaction.findMany({ where: { bankAccountId }, orderBy: { date: "asc" } });
    expect(txs.map((t) => [t.amount, t.rawRow.startsWith("hal. 1 · ")])).toEqual([[20_000_000n, true], [-4_440_000n, true]]);
    const imp = await db.statementImport.findUniqueOrThrow({ where: { id: s.importId } });
    expect(JSON.stringify(imp, (_, v) => (typeof v === "bigint" ? String(v) : v))).not.toContain("rahasia");

    const again = await importStatement(db, { bankAccountId, fileName: "mandiri.pdf", data: pdf, provider: null, password: "rahasia" });
    expect(again.duplicates).toBe(2);
  });
});
