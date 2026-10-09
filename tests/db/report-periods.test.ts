import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { dateOnly } from "@/lib/format";
import { reportPeriods } from "@/lib/reports/periods";
import { statementSet } from "@/lib/reports/statement-set";
import { financialNotes } from "@/lib/reports/notes";

/**
 * One period rule for page, PDF / Excel and CALK (lib/reports/periods.ts): books opened by a Saldo Awal on 28 Feb report 1 Maret onwards, the
 * Neraca compares with the Saldo Awal position (not a column of dashes at 31 Desember), and nothing compares with an empty last year.
 */
describe("report periods", () => {
  beforeEach(resetDb);

  async function opened() {
    const g = await makeGroup();
    const id = async (code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
    const post = (date: Date, kind: "OPENING" | "ADJUSTMENT", lines: [string, bigint, bigint][]) =>
      db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date, kind, memo: kind, lines: await Promise.all(lines.map(async ([c, d, k]) => ({ accountId: c === "bank" ? g.pt.banks[0].accountId : await id(c), debit: d, credit: k }))) }));
    await post(dateOnly(2026, 2, 28), "OPENING", [["bank", 145_000_000n, 0n], ["3100", 0n, 145_000_000n]]);
    await post(dateOnly(2026, 4, 30), "ADJUSTMENT", [["bank", 20_000_000n, 0n], ["4100", 0n, 20_000_000n]]);
    return { g, scope: { clientId: g.client.id, entityIds: [g.pt.entity.id] } };
  }

  it("books opened by a Saldo Awal inside the year: from the day after it, compared with the Saldo Awal position, no empty last year", async () => {
    const { scope } = await opened();
    const p = await reportPeriods(db, scope, 2026, 7);
    expect([p.booksStart, p.ytdFrom, p.beforeBooks, p.priorPl]).toEqual([dateOnly(2026, 3, 1), dateOnly(2026, 3, 1), false, null]);
    expect(p.balanceComparative).toEqual({ date: dateOnly(2026, 2, 28), label: "Saldo awal 28 Februari 2026", opening: true });

    const set = await statementSet(db, scope, 2026, 7);
    const st = (name: string) => set.statements.find((s) => s.name === name)!;
    expect([st("Laba Rugi").subtitle, st("Laba Rugi").columns]).toEqual(["Untuk periode 1 Maret – 31 Juli 2026", ["1 Maret – 31 Juli 2026"]]);
    expect([st("Neraca").subtitle, st("Neraca").columns]).toEqual(["Per 31 Juli 2026 dan saldo awal 28 Februari 2026", ["31 Juli 2026", "Saldo awal 28 Februari 2026"]]);
    // The comparative holds the opening position, not dashes.
    const cash = st("Neraca").rows.find((r) => r.label === "Kas dan setara kas")!;
    expect(cash.values).toEqual([165_000_000n, 145_000_000n]);
    for (const name of ["Perubahan Ekuitas", "Arus Kas"]) expect(st(name).subtitle).toBe("Untuk periode 1 Maret – 31 Juli 2026");
    expect(st("Perubahan Ekuitas").rows[0].label).toBe("Saldo 28 Februari 2026");

    const notes = await financialNotes(db, scope, 2026, 7);
    expect(notes.comparativeLabel).toBe("Saldo awal 28 Februari 2026");
    const kas = notes.notes.find((n) => n.title === "Kas dan setara kas")!.tables[0];
    expect(kas.columns).toEqual(["Akun", "31 Juli 2026", "Saldo awal 28 Februari 2026"]);
    const revenue = notes.notes.find((n) => n.title === "Pendapatan usaha")!.tables[0];
    expect([revenue.columns, revenue.total]).toEqual([["Akun", "1 Maret – 31 Juli 2026"], ["Jumlah", 20_000_000n]]);
  });

  it("the month of the Saldo Awal itself is a position with no comparative; books without any opening keep the year end", async () => {
    const { g, scope } = await opened();
    const feb = await reportPeriods(db, scope, 2026, 2);
    expect([feb.beforeBooks, feb.balanceComparative]).toEqual([true, null]);
    // The owner's books: one entry in 2025 and one in 2026, no Saldo Awal: the year end and last year's months compare.
    const id = async (code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
    for (const d of [dateOnly(2025, 6, 10), dateOnly(2026, 6, 10)]) {
      await db.$transaction(async (tx) => postJournal(tx, { entityId: g.owner.entity.id, date: d, kind: "ADJUSTMENT", memo: "uji", lines: [{ accountId: g.owner.banks[0].accountId, debit: 1000n }, { accountId: await id("4100"), credit: 1000n }] }));
    }
    const owner = await reportPeriods(db, { clientId: g.client.id, entityIds: [g.owner.entity.id] }, 2026, 7);
    expect(owner.balanceComparative).toEqual({ date: dateOnly(2025, 12, 31), label: "31 Desember 2025", opening: false });
    expect(owner.priorPl).toEqual({ start: dateOnly(2025, 1, 1), end: dateOnly(2025, 7, 31) });
  });
});
