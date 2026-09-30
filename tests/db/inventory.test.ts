import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { dateOnly } from "@/lib/format";
import { cogsBreakdown, inventoryBalance, inventoryRows, recordInventoryCount } from "@/lib/inventory";
import { CLOSE_SIGNOFFS, lockPeriod, runControls } from "@/lib/controls";
import { incomeStatement } from "@/lib/reports/ledger";
import { financialNotes } from "@/lib/reports/notes";
import { deleteClient } from "@/lib/clients/delete";

type G = Awaited<ReturnType<typeof makeGroup>>;
const acc = async (g: G, code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
async function post(g: G, date: Date, kind: "OPENING" | "ADJUSTMENT", debit: string, credit: string, amount: bigint) {
  return db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date, kind, memo: "uji", lines: [{ accountId: await acc(g, debit), debit: amount }, { accountId: await acc(g, credit), credit: amount }] }));
}
const count = (g: G, month: number, amount: bigint) => recordInventoryCount(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month, amount, actorId: null });
const book = (g: G, month: number) => inventoryBalance(db, g.client.id, [g.pt.entity.id], { to: new Date(Date.UTC(2026, month, 0)) });
const control = async (g: G, month: number) => (await runControls(db, g.client.id, 2026, month)).find((c) => c.key === `inv:${g.pt.entity.id}`);

describe("persediaan akhir (stock opname), periodic method", () => {
  beforeEach(resetDb);

  it("asks for the count only where there is inventory", async () => {
    const g = await makeGroup();
    await post(g, dateOnly(2026, 3, 10), "ADJUSTMENT", "6190", "1120", 1000n);
    expect(await control(g, 3)).toBeUndefined();
    expect((await inventoryRows(db, g.client.id, 2026, 3)).every((r) => !r.applies)).toBe(true);
    // A trading business with cost of sales is asked even before it holds stock.
    await db.client.update({ where: { id: g.client.id }, data: { industry: "distributor bahan bangunan" } });
    await post(g, dateOnly(2026, 3, 12), "ADJUSTMENT", "5100", "1120", 5000n);
    expect((await control(g, 3))?.status).toBe("REVIEW");
  });

  it("books the difference to 5190, re-counts book only the new difference, an equal count books nothing", async () => {
    const g = await makeGroup();
    await post(g, dateOnly(2026, 2, 28), "OPENING", "1160", "3100", 100_000n);
    await post(g, dateOnly(2026, 3, 5), "ADJUSTMENT", "5100", "1120", 50_000n);
    expect(await control(g, 3)).toMatchObject({ status: "REVIEW", detail: expect.stringContaining("belum dicatat") });

    const first = await count(g, 3, 120_000n);
    expect(first).toMatchObject({ amount: 120_000n, bookBefore: 100_000n });
    const entry = await db.journalEntry.findUniqueOrThrow({ where: { id: first.entryId! }, include: { lines: { include: { account: true } } } });
    expect(entry.kind).toBe("ADJUSTMENT");
    expect(+entry.date).toBe(+dateOnly(2026, 3, 31));
    expect(entry.lines.map((l) => [l.account.code, l.debit, l.credit]).sort()).toEqual([["1160", 20_000n, 0n], ["5190", 0n, 20_000n]]);
    expect(await book(g, 3)).toBe(120_000n);
    expect(await control(g, 3)).toMatchObject({ status: "PASS" });

    // HPP = awal 100.000 + pembelian 50.000 − akhir 120.000 = 30.000, and the CALK shows exactly the Laba Rugi line.
    const is = await incomeStatement(db, { clientId: g.client.id, entityIds: [g.pt.entity.id] }, dateOnly(2026, 1, 1), dateOnly(2026, 3, 31));
    expect(is.cogs.reduce((t, i) => t + i.amount, 0n)).toBe(30_000n);
    expect(await cogsBreakdown(db, g.client.id, [g.pt.entity.id], dateOnly(2026, 1, 1), dateOnly(2026, 3, 31))).toEqual({ opening: 100_000n, purchases: 50_000n, direct: 0n, closing: 120_000n, total: 30_000n });
    const notes = await financialNotes(db, { clientId: g.client.id, entityIds: [g.pt.entity.id] }, 2026, 3);
    const hpp = notes.notes.find((n) => n.paragraphs.some((p) => p.startsWith("Perhitungan beban pokok penjualan")))!;
    expect(hpp.tables.at(-1)).toMatchObject({ rows: [["Persediaan awal", 100_000n], ["Pembelian", 50_000n], ["Barang tersedia untuk dijual", 150_000n], ["Persediaan akhir", -120_000n]], total: ["Beban pokok penjualan", 30_000n] });
    expect(notes.notes[1].paragraphs.some((p) => p.includes("stock opname"))).toBe(true);

    const second = await count(g, 3, 90_000n);
    const lines = await db.journalLine.findMany({ where: { entryId: second.entryId! }, include: { account: true } });
    expect(lines.map((l) => [l.account.code, l.debit, l.credit]).sort()).toEqual([["1160", 0n, 30_000n], ["5190", 30_000n, 0n]]);
    expect(await book(g, 3)).toBe(90_000n);

    const same = await count(g, 3, 90_000n);
    expect(same.entryId).toBe(second.entryId);
    expect(await db.inventoryCount.count()).toBe(1);
    expect(await db.journalEntry.count({ where: { memo: { contains: "stock opname" } } })).toBe(2);
  });

  it("flags books that moved after the count", async () => {
    const g = await makeGroup();
    await post(g, dateOnly(2026, 2, 28), "OPENING", "1160", "3100", 100_000n);
    await count(g, 3, 100_000n);
    expect(await control(g, 3)).toMatchObject({ status: "PASS" });
    await post(g, dateOnly(2026, 3, 20), "ADJUSTMENT", "1160", "1120", 7_000n);
    expect(await control(g, 3)).toMatchObject({ status: "REVIEW", detail: expect.stringContaining("catat ulang") });
  });

  it("refuses a negative count, an earlier month once a later one is counted, and a locked month", async () => {
    const g = await makeGroup();
    await post(g, dateOnly(2026, 2, 28), "OPENING", "1160", "3100", 100_000n);
    await expect(count(g, 3, -1n)).rejects.toThrow("Nilai persediaan tidak boleh negatif.");
    await count(g, 4, 80_000n);
    await expect(count(g, 3, 90_000n)).rejects.toThrow("Persediaan April 2026 sudah dicatat. Koreksi hitungan lewat bulan itu atau sesudahnya.");

    await post(g, dateOnly(2026, 5, 3), "ADJUSTMENT", "5100", "1120", 1_000n);
    const period = await db.period.upsert({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month: 5 } }, create: { firmId: g.firm.id, clientId: g.client.id, year: 2026, month: 5 }, update: {} });
    await db.closeSignoff.createMany({ data: CLOSE_SIGNOFFS.map((s) => ({ periodId: period.id, key: s.key })) });
    for (const c of (await runControls(db, g.client.id, 2026, 5)).filter((c) => c.status === "REVIEW")) await db.controlAck.create({ data: { periodId: period.id, controlKey: c.key, note: "Wajar untuk uji", detail: c.detail } });
    const apr = await db.period.findUniqueOrThrow({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month: 4 } } });
    await db.closeSignoff.createMany({ data: CLOSE_SIGNOFFS.map((s) => ({ periodId: apr.id, key: s.key })) });
    for (const c of (await runControls(db, g.client.id, 2026, 4)).filter((c) => c.status === "REVIEW")) await db.controlAck.create({ data: { periodId: apr.id, controlKey: c.key, note: "Wajar untuk uji", detail: c.detail } });
    await lockPeriod(db, g.client.id, 2026, 4, "uji");
    await lockPeriod(db, g.client.id, 2026, 5, "uji");
    await expect(count(g, 5, 70_000n)).rejects.toThrow("Periode Mei 2026 sudah ditutup. Buka kembali dulu untuk mencatat persediaan.");
  });

  it("goes with the client when it is deleted", async () => {
    const g = await makeGroup();
    await post(g, dateOnly(2026, 2, 28), "OPENING", "1160", "3100", 100_000n);
    await count(g, 3, 120_000n);
    await deleteClient(db, { firmId: g.firm.id, clientId: g.client.id, confirmName: "Grup Uji" });
    expect(await db.inventoryCount.count()).toBe(0);
  });
});
