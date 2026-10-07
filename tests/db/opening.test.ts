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
    // The owner has no statement yet: its Saldo Awal starts with the group's, not at the end of last calendar month.
    const owner = (await openingContext(db, g.client.id)).find((c) => c.entity.id === g.owner.entity.id)!;
    expect(owner.suggestedDate.toISOString().slice(0, 10)).toBe("2026-07-31");
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
      ["3290", 0n, 20_000_000n],
    ]);
    // No plug (ADR 0012): the difference waits on 3290 as an open Temuan with its question, never on 3200.
    const [finding] = await db.finding.findMany({ where: { clientId: g.client.id } });
    expect(finding).toMatchObject({ number: 1, kind: "OPENING_DIFFERENCE", status: "OPEN", amount: -20_000_000n, sourceEntryId: entry.id });
    expect(finding.question).toContain("aset yang diisi lebih besar Rp 20.000.000 dari liabilitas + ekuitas");
    const after = await runControls(db, g.client.id, 2026, 8);
    expect(after.find((c) => c.key === `bank:${mandiri.id}`)?.status).toBe("PASS");
  });

  it("a balanced Saldo Awal with a typed Saldo Laba posts no difference and opens no Temuan; 3290 can't be typed", async () => {
    const g = await makeGroup();
    const base = { clientId: g.client.id, entityId: g.pt.entity.id, date: dateOnly(2026, 7, 31) };
    await expect(postOpening(db, { ...base, lines: [{ accountCode: "1102", debit: "5", credit: "" }, { accountCode: "3290", debit: "", credit: "5" }] })).rejects.toThrow(/3290 Selisih Saldo Awal diisi otomatis/);
    const r = await postOpening(db, { ...base, lines: [{ accountCode: "1102", debit: "50.000.000", credit: "" }, { accountCode: "3100", debit: "", credit: "30.000.000" }, { accountCode: "3200", debit: "", credit: "20.000.000" }] });
    expect(r.finding).toBeNull();
    expect(await db.finding.count()).toBe(0);
    expect(await db.journalLine.count({ where: { account: { code: "3290" } } })).toBe(0);
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

  it("SGD entity: balances are typed in dollars and posted in cents, the difference included", async () => {
    const g = await makeGroup();
    await db.entity.update({ where: { id: g.pt.entity.id }, data: { functionalCurrency: "SGD" } });
    await postOpening(db, {
      clientId: g.client.id,
      entityId: g.pt.entity.id,
      date: dateOnly(2026, 7, 31),
      lines: [
        { accountCode: "1102", debit: "1.000,00", credit: "" },
        { accountCode: "2210", debit: "", credit: "250,5" },
      ],
    });
    const entry = await db.journalEntry.findFirstOrThrow({ where: { entityId: g.pt.entity.id, kind: "OPENING" }, include: { lines: { include: { account: true } } } });
    expect(entry.lines.map((l) => [l.account.code, l.debit, l.credit]).sort()).toEqual([
      ["1102", 100_000n, 0n],
      ["2210", 0n, 25_050n],
      ["3290", 0n, 74_950n],
    ]);
    await expect(
      postOpening(db, { clientId: g.client.id, entityId: g.owner.entity.id, date: dateOnly(2026, 7, 31), lines: [{ accountCode: "1103", debit: "12,5", credit: "" }] }),
    ).rejects.toThrow("Rupiah tidak memakai angka desimal");
  });
});
