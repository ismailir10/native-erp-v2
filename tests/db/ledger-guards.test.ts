import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { getOrCreatePeriod, postJournal } from "@/lib/ledger/post";
import { deleteClient } from "@/lib/clients/delete";
import { dateOnly } from "@/lib/format";

// The database refuses what postJournal() refuses (accounting-rules 2–4), even for a write that goes around it.
type G = Awaited<ReturnType<typeof makeGroup>>;
let g: G;
let bank: string;
let sales: string;

const code = async (c: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code: c } })).id;
const period = (month: number) => db.$transaction((tx) => getOrCreatePeriod(tx, g.firm.id, g.client.id, dateOnly(2026, month, 1)));
const lock = (month: number) => db.period.update({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month } }, data: { status: "LOCKED" } });

/** A raw entry written straight through Prisma, i.e. around postJournal(). */
async function raw(month: number, lines: { accountId: string; debit?: bigint; credit?: bigint; date?: Date }[], opts: { periodMonth?: number; day?: number } = {}) {
  const date = dateOnly(2026, month, opts.day ?? 10);
  const p = await period(opts.periodMonth ?? month);
  return db.journalEntry.create({
    data: {
      firmId: g.firm.id,
      entityId: g.pt.entity.id,
      periodId: p.id,
      date,
      kind: "ADJUSTMENT",
      memo: "raw",
      lines: { create: lines.map((l) => ({ firmId: g.firm.id, entityId: g.pt.entity.id, accountId: l.accountId, date: l.date ?? date, debit: l.debit ?? 0n, credit: l.credit ?? 0n })) },
    },
    include: { lines: true },
  });
}

const post = (month: number, amount = 1000n) =>
  db.$transaction((tx) =>
    postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, month, 10), kind: "ADJUSTMENT", memo: "uji", lines: [{ accountId: bank, debit: amount }, { accountId: sales, credit: amount }] }),
  );

beforeEach(async () => {
  await resetDb();
  g = await makeGroup();
  bank = await code("1120");
  sales = await code("4100");
});

describe("balanced (rule 2)", () => {
  it("accepts a balanced entry written around postJournal", async () => {
    const e = await raw(3, [{ accountId: bank, debit: 500n }, { accountId: sales, credit: 500n }]);
    expect(e.lines).toHaveLength(2);
  });

  it("refuses an unbalanced entry at commit", async () => {
    await expect(raw(3, [{ accountId: bank, debit: 500n }, { accountId: sales, credit: 400n }])).rejects.toThrow(/tidak seimbang/);
    expect(await db.journalEntry.count()).toBe(0);
  });

  it("refuses a single-line entry and an entry without lines", async () => {
    await expect(raw(3, [{ accountId: bank, debit: 500n }])).rejects.toThrow(/minimal dua baris/);
    await expect(raw(3, [])).rejects.toThrow(/minimal dua baris/);
    expect(await db.journalEntry.count()).toBe(0);
  });

  it("refuses deleting one line of a posted entry", async () => {
    const e = await post(3);
    await expect(db.journalLine.delete({ where: { id: e.lines[0].id } })).rejects.toThrow(/minimal dua baris/);
    expect(await db.journalLine.count({ where: { entryId: e.id } })).toBe(2);
  });

  it("lets a whole entry go with its lines (an import removed in an open month)", async () => {
    const e = await post(3);
    await db.journalEntry.delete({ where: { id: e.id } });
    expect(await db.journalLine.count()).toBe(0);
  });
});

describe("immutable (rule 3)", () => {
  it("refuses changing a posted amount, account or date; other columns still change", async () => {
    const e = await post(3);
    const line = e.lines.find((l) => l.debit > 0n)!;
    await expect(db.journalLine.update({ where: { id: line.id }, data: { debit: 2000n } })).rejects.toThrow(/tidak bisa diubah/);
    await expect(db.journalLine.update({ where: { id: line.id }, data: { accountId: sales } })).rejects.toThrow(/tidak bisa diubah/);
    await expect(db.journalEntry.update({ where: { id: e.id }, data: { date: dateOnly(2026, 3, 11) } })).rejects.toThrow(/tidak bisa diubah/);
    await expect(db.journalEntry.update({ where: { id: e.id }, data: { kind: "OPENING" } })).rejects.toThrow(/tidak bisa diubah/);
    await db.journalLine.update({ where: { id: line.id }, data: { memo: "catatan" } });
    await db.journalEntry.update({ where: { id: e.id }, data: { memo: "memo baru" } });
    expect((await db.journalLine.findUniqueOrThrow({ where: { id: line.id } })).debit).toBe(1000n);
  });
});

describe("period of its own date", () => {
  it("refuses an entry filed under another month and a line dated off its entry", async () => {
    await expect(raw(3, [{ accountId: bank, debit: 5n }, { accountId: sales, credit: 5n }], { periodMonth: 4 })).rejects.toThrow(/periode bulannya sendiri/);
    await expect(raw(3, [{ accountId: bank, debit: 5n }, { accountId: sales, credit: 5n, date: dateOnly(2026, 3, 11) }])).rejects.toThrow(/entitas dan tanggal jurnalnya/);
    expect(await db.journalEntry.count()).toBe(0);
  });
});

describe("locked month (rule 4)", () => {
  it("refuses inserting into, and deleting from, a closed month", async () => {
    const e = await post(3);
    await lock(3);
    await expect(raw(3, [{ accountId: bank, debit: 5n }, { accountId: sales, credit: 5n }])).rejects.toThrow(/sudah ditutup/);
    await expect(db.journalEntry.delete({ where: { id: e.id } })).rejects.toThrow(/sudah ditutup/);
    await expect(db.journalLine.deleteMany({ where: { entryId: e.id } })).rejects.toThrow(/sudah ditutup/);
    expect(await db.journalLine.count({ where: { entryId: e.id } })).toBe(2);
    // postJournal still refuses first, with its own message.
    await expect(post(3)).rejects.toThrow(/sudah ditutup/);
  });

  it("an open month next to a closed one still takes entries", async () => {
    await post(3);
    await lock(3);
    await expect(post(4)).resolves.toBeTruthy();
  });

  it("deleting a whole client still works with a closed month", async () => {
    await post(3);
    await lock(3);
    await deleteClient(db, { firmId: g.firm.id, clientId: g.client.id, confirmName: g.client.name });
    expect(await db.journalEntry.count()).toBe(0);
    expect(await db.client.count({ where: { id: g.client.id } })).toBe(0);
  });

  it("the client-delete bypass lasts only for that transaction", async () => {
    const e = await post(3);
    await lock(3);
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('buku.client_delete', 'on', true)`;
    });
    await expect(db.journalEntry.delete({ where: { id: e.id } })).rejects.toThrow(/sudah ditutup/);
  });
});
