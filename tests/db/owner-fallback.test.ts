import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { makePdf, table } from "../pdf-fixture";
import { importStatement } from "@/lib/import/pipeline";

const statement = (number: string) =>
  makePdf([
    [
      ...table(800, [[[40, "PT Bank Mandiri (Persero) Tbk"]], [[40, `Nomor Rekening : ${number}`]], [[40, "Periode : 01/08/2026 - 31/08/2026"]]]),
      ...table(740, [
        [[40, "Tanggal"], [130, "Keterangan"], [360, "Debit"], [440, "Kredit"], [520, "Saldo"]],
        [[40, "01/08/2026"], [130, "SALDO AWAL"], [500, "0,00"]],
        [[40, "04/08/2026"], [130, "SETORAN BUDI HARTONO"], [430, "250.000.000,00"], [510, "250.000.000,00"]],
        [[40, "10/08/2026"], [130, "TOKO EMAS CAHAYA"], [360, "5.000.000,00"], [510, "245.000.000,00"]],
      ]),
    ],
  ]);

describe("simple guess by entity kind", () => {
  beforeEach(resetDb);

  it("guesses other income and Prive for a person's own account, sales and expense for a company, all to review", async () => {
    const g = await makeGroup();
    await importStatement(db, { bankAccountId: g.owner.banks[0].id, fileName: "owner.pdf", data: statement("3333333333"), provider: null });
    await importStatement(db, { bankAccountId: g.pt.banks[1].id, fileName: "pt.pdf", data: statement("2222222222"), provider: null });
    const rows = async (entityId: string) =>
      (await db.bankTransaction.findMany({ where: { entityId }, orderBy: { date: "asc" } })).map((t) => [t.suggestedCode, t.method, t.status]);
    expect(await rows(g.owner.entity.id)).toEqual([
      ["4910", "HEURISTIC", "NEEDS_REVIEW"],
      ["3300", "HEURISTIC", "NEEDS_REVIEW"],
    ]);
    expect(await rows(g.pt.entity.id)).toEqual([
      ["4100", "HEURISTIC", "NEEDS_REVIEW"],
      ["6190", "HEURISTIC", "NEEDS_REVIEW"],
    ]);
  });
});
