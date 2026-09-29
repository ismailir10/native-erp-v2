import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postAdjustment } from "@/lib/ledger/adjustment";
import { LedgerError } from "@/lib/ledger/post";
import { MoneyError } from "@/lib/money";
import { dateOnly } from "@/lib/format";
import { runControls } from "@/lib/controls";

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
  it("keeps each entity's bank account in its own books; a leftover can only be cleared", async () => {
    const g = await makeGroup();
    const base = { clientId: g.client.id, entityId: g.pt.entity.id, date: dateOnly(2026, 6, 30), memo: "Uji" };
    const pair = (dr: string, cr: string, amount = "1.000") => [{ accountCode: dr, debit: amount, credit: "" }, { accountCode: cr, debit: "", credit: amount }];
    // 1103 is the owner's BRI account: the PT can't post to it.
    await expect(postAdjustment(db, { ...base, lines: pair("1103", "6190") })).rejects.toThrow("adalah rekening bank Andi, jadi tidak bisa dipakai di buku PT Uji");
    // Its own bank still works.
    await postAdjustment(db, { ...base, lines: pair("1101", "6190") });

    // Books posted before the rule: a PT line sits on the owner's bank account → REVIEW control.
    const [bri, beban, period] = await Promise.all([
      db.account.findFirstOrThrow({ where: { clientId: g.client.id, code: "1103" } }),
      db.account.findFirstOrThrow({ where: { clientId: g.client.id, code: "6190" } }),
      db.period.findFirstOrThrow({ where: { clientId: g.client.id, year: 2026, month: 6 } }),
    ]);
    const legacy = { firmId: g.firm.id, entityId: g.pt.entity.id, date: dateOnly(2026, 6, 30) };
    await db.journalEntry.create({ data: { ...legacy, periodId: period.id, kind: "ADJUSTMENT", memo: "lama", lines: { create: [{ ...legacy, accountId: bri.id, debit: 1000n, credit: 0n }, { ...legacy, accountId: beban.id, debit: 0n, credit: 1000n }] } } });
    const flagged = (await runControls(db, g.client.id, 2026, 6)).find((c) => c.key === `bank-entity:${g.pt.entity.id}`);
    expect([flagged?.status, flagged?.detail]).toEqual(["REVIEW", expect.stringContaining("Buku PT Uji menyimpan saldo Rp 1.000 di 1103")]);

    // Clearing more than is held, or pushing it further, is refused; clearing it exactly is accepted.
    await expect(postAdjustment(db, { ...base, lines: pair("6190", "1103", "2.000") })).rejects.toBeInstanceOf(LedgerError);
    await expect(postAdjustment(db, { ...base, lines: pair("1103", "6190", "500") })).rejects.toBeInstanceOf(LedgerError);
    await postAdjustment(db, { ...base, lines: pair("6190", "1103") });
    const net = await db.journalLine.aggregate({ where: { entityId: g.pt.entity.id, accountId: bri.id }, _sum: { debit: true, credit: true } });
    expect((net._sum.debit ?? 0n) - (net._sum.credit ?? 0n)).toBe(0n);
    expect((await runControls(db, g.client.id, 2026, 6)).some((c) => c.key.startsWith("bank-entity:"))).toBe(false);
  });
});
