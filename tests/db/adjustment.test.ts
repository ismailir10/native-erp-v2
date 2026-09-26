import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postAdjustment } from "@/lib/ledger/adjustment";
import { LedgerError } from "@/lib/ledger/post";
import { MoneyError } from "@/lib/money";
import { dateOnly } from "@/lib/format";

async function postedLines(entryId: string) {
  const lines = await db.journalLine.findMany({ where: { entryId }, include: { account: true } });
  return lines.map((l) => [l.account.code, l.debit, l.credit]).sort();
}

describe("Jurnal penyesuaian: typed amounts are major units of the entity currency", () => {
  beforeEach(resetDb);

  it("SGD entity: 100 posts S$100.00 (10000 cents), 12,34 posts 1234", async () => {
    const g = await makeGroup();
    await db.entity.update({ where: { id: g.pt.entity.id }, data: { functionalCurrency: "SGD" } });
    const base = { clientId: g.client.id, entityId: g.pt.entity.id, date: dateOnly(2026, 8, 31) };

    const a = await postAdjustment(db, { ...base, memo: "Penyusutan", lines: [{ accountCode: "6180", debit: "100", credit: "" }, { accountCode: "1219", debit: "", credit: "100" }] });
    expect(await postedLines(a.id)).toEqual([["1219", 0n, 10_000n], ["6180", 10_000n, 0n]]);

    const b = await postAdjustment(db, { ...base, memo: "Akrual", lines: [{ accountCode: "6190", debit: "S$ 12,34", credit: "" }, { accountCode: "2150", debit: "", credit: "12,34" }] });
    expect(await postedLines(b.id)).toEqual([["2150", 0n, 1_234n], ["6190", 1_234n, 0n]]);
  });

  it("IDR entity: whole Rupiah, as before", async () => {
    const g = await makeGroup();
    const e = await postAdjustment(db, {
      clientId: g.client.id,
      entityId: g.pt.entity.id,
      date: dateOnly(2026, 8, 31),
      memo: "Penyusutan",
      lines: [{ accountCode: "6180", debit: "1.500.000", credit: "" }, { accountCode: "1219", debit: "", credit: "1500000,00" }],
    });
    expect(await postedLines(e.id)).toEqual([["1219", 0n, 1_500_000n], ["6180", 1_500_000n, 0n]]);
  });

  it("refuses unreadable amounts, sub-cent decimals and other clients' entities; nothing is posted", async () => {
    const g = await makeGroup();
    const other = await makeGroup();
    await db.entity.update({ where: { id: g.pt.entity.id }, data: { functionalCurrency: "SGD" } });
    const base = { clientId: g.client.id, entityId: g.pt.entity.id, date: dateOnly(2026, 8, 31), memo: "Uji" };
    const pair = (dr: string, cr: string) => [{ accountCode: "6180", debit: dr, credit: "" }, { accountCode: "1219", debit: "", credit: cr }];

    await expect(postAdjustment(db, { ...base, lines: pair("1,005", "1,005") })).rejects.toThrow('Dolar Singapura paling banyak 2 angka di belakang koma: "1,005".');
    await expect(postAdjustment(db, { ...base, lines: pair("100.50", "100.50") })).rejects.toBeInstanceOf(MoneyError);
    await expect(postAdjustment(db, { ...base, entityId: other.pt.entity.id, lines: pair("1", "1") })).rejects.toBeInstanceOf(LedgerError);
    await expect(postAdjustment(db, { ...base, memo: "  ", lines: pair("1", "1") })).rejects.toThrow("Isi keterangan jurnal.");
    expect(await db.journalEntry.count({ where: { kind: "ADJUSTMENT" } })).toBe(0);
  });
});
