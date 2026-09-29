import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { makePdf, table } from "../pdf-fixture";
import { importStatement } from "@/lib/import/pipeline";
import { MockProvider } from "@/lib/ai/provider";

describe("classifier: loan lines", () => {
  beforeEach(resetDb);

  it("suggests the balance sheet for a loan (to review) and files its interest by firm rule, without an AI call", async () => {
    const g = await makeGroup();
    const pdf = makePdf([
      [
        ...table(800, [[[40, "PT Bank Mandiri (Persero) Tbk"]], [[40, "Nomor Rekening : 2222222222"]], [[40, "Periode : 01/08/2026 - 31/08/2026"]]]),
        ...table(740, [
          [[40, "Tanggal"], [130, "Keterangan"], [360, "Debit"], [440, "Kredit"], [520, "Saldo"]],
          [[40, "01/08/2026"], [130, "SALDO AWAL"], [500, "0,00"]],
          [[40, "04/08/2026"], [130, "PENCAIRAN PINJAMAN KMK"], [430, "100.000.000,00"], [510, "100.000.000,00"]],
          [[40, "10/08/2026"], [130, "BUNGA PINJAMAN KMK"], [360, "1.000.000,00"], [520, "99.000.000,00"]],
          [[40, "25/08/2026"], [130, "ANGSURAN POKOK PINJAMAN KMK"], [360, "5.000.000,00"], [520, "94.000.000,00"]],
        ]),
      ],
    ]);
    const provider = new MockProvider();
    await importStatement(db, { bankAccountId: g.pt.banks[1].id, fileName: "m.pdf", data: pdf, provider });
    const txs = await db.bankTransaction.findMany({ where: { entityId: g.pt.entity.id }, orderBy: { date: "asc" } });
    expect(txs.map((t) => [t.suggestedCode ?? t.accountCode, t.method, t.status])).toEqual([
      ["2210", "HEURISTIC", "NEEDS_REVIEW"],
      ["7110", "RULE", "POSTED"],
      ["2210", "HEURISTIC", "NEEDS_REVIEW"],
    ]);
    expect(provider.calls).toBe(0);
  });
});
