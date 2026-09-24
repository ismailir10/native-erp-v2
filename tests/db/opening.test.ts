import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { makePdf, table } from "../pdf-fixture";
import { importStatement } from "@/lib/import/pipeline";
import { openingContext, OpeningError, postOpening } from "@/lib/opening";
import { runControls } from "@/lib/controls";
import { dateOnly } from "@/lib/format";

const statement = makePdf([
  [
    ...table(800, [[[40, "PT Bank Mandiri (Persero) Tbk"]], [[40, "Nomor Rekening : 2222222222"]], [[40, "Periode : 01/08/2026 - 31/08/2026"]]]),
    ...table(740, [
      [[40, "Tanggal"], [130, "Keterangan"], [360, "Debit"], [440, "Kredit"], [520, "Saldo"]],
      [[40, "01/08/2026"], [130, "SALDO AWAL"], [500, "50.000.000,00"]],
      [[40, "04/08/2026"], [130, "TRANSFER DARI PT MITRA UNGGAS"], [430, "20.000.000,00"], [510, "70.000.000,00"]],
    ]),
  ],
]);

describe("Saldo awal", () => {
  beforeEach(resetDb);

  it("prefills from the first statement and makes the bank reconcile after posting", async () => {
    const g = await makeGroup();
    const mandiri = g.pt.banks[1];
    await importStatement(db, { bankAccountId: mandiri.id, fileName: "mandiri-agu.pdf", data: statement, provider: null });

    const pt = (await openingContext(db, g.client.id)).find((c) => c.entity.id === g.pt.entity.id)!;
    expect(pt.existing).toBeFalsy();
    expect(pt.suggestedDate.toISOString().slice(0, 10)).toBe("2026-07-31");
    const line = pt.banks.find((b) => b.accountCode === "1102")!;
    expect(line.statementOpening).toBe(50_000_000n);

    const before = await runControls(db, g.client.id, 2026, 8);
    expect(before.find((c) => c.key === `bank:${mandiri.id}`)?.status).toBe("FAIL");

    await postOpening(db, {
      clientId: g.client.id,
      entityId: g.pt.entity.id,
      date: dateOnly(2026, 7, 31),
      lines: [
        { accountCode: "1102", debit: "50.000.000", credit: "" },
        { accountCode: "2210", debit: "", credit: "30.000.000" },
      ],
    });
    const entry = await db.journalEntry.findFirstOrThrow({ where: { entityId: g.pt.entity.id, kind: "OPENING" }, include: { lines: { include: { account: true } } } });
    expect(entry.lines.map((l) => [l.account.code, l.debit, l.credit]).sort()).toEqual([
      ["1102", 50_000_000n, 0n],
      ["2210", 0n, 30_000_000n],
      ["3200", 0n, 20_000_000n],
    ]);
    const after = await runControls(db, g.client.id, 2026, 8);
    expect(after.find((c) => c.key === `bank:${mandiri.id}`)?.status).toBe("PASS");
  });

  it("refuses a second opening, a date on/after the first transaction, and empty input", async () => {
    const g = await makeGroup();
    await importStatement(db, { bankAccountId: g.pt.banks[1].id, fileName: "m.pdf", data: statement, provider: null });
    const base = { clientId: g.client.id, entityId: g.pt.entity.id };
    await expect(postOpening(db, { ...base, date: dateOnly(2026, 8, 4), lines: [{ accountCode: "1102", debit: "1", credit: "" }] })).rejects.toThrow(/sebelum transaksi bank pertama/);
    await expect(postOpening(db, { ...base, date: dateOnly(2026, 7, 31), lines: [{ accountCode: "", debit: "", credit: "" }] })).rejects.toThrow("Isi minimal satu saldo.");
    await postOpening(db, { ...base, date: dateOnly(2026, 7, 31), lines: [{ accountCode: "1102", debit: "50.000.000", credit: "" }] });
    await expect(postOpening(db, { ...base, date: dateOnly(2026, 7, 31), lines: [{ accountCode: "1102", debit: "1", credit: "" }] })).rejects.toBeInstanceOf(OpeningError);
  });
});
