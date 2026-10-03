import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { statementSet } from "@/lib/reports/statement-set";
import { financialNotes } from "@/lib/reports/notes";
import { dateOnly } from "@/lib/format";

const J = 1_000_000n;

/** Statements for a client closing on 31 January: the year, its comparatives and its labels follow the tahun buku. */
describe("financial year in the statements", () => {
  beforeEach(resetDb);

  async function books(endMonth: number) {
    const g = await makeGroup();
    await db.client.update({ where: { id: g.client.id }, data: { fiscalYearEndMonth: endMonth } });
    const acc = async (code: string) => (await db.account.findUniqueOrThrow({ where: { clientId_code: { clientId: g.client.id, code } } })).id;
    await db.$transaction(async (tx) => {
      const post = async (date: Date, lines: [string, bigint, bigint][]) =>
        postJournal(tx, { entityId: g.pt.entity.id, date, kind: "ADJUSTMENT", memo: "uji", lines: await Promise.all(lines.map(async ([c, d, k]) => ({ accountId: await acc(c), debit: d, credit: k }))) });
      await post(dateOnly(2025, 3, 1), [["1110", 500n * J, 0n], ["3100", 0n, 500n * J]]);
      await post(dateOnly(2025, 6, 15), [["1110", 70n * J, 0n], ["4100", 0n, 70n * J]]); // last year, Feb–Agu 2025
      await post(dateOnly(2026, 1, 15), [["1110", 100n * J, 0n], ["4100", 0n, 100n * J]]); // closes the year to 31 Jan 2026
      await post(dateOnly(2026, 3, 15), [["1110", 40n * J, 0n], ["4100", 0n, 40n * J]]);
    });
    return { clientId: g.client.id, entityIds: [g.pt.entity.id] };
  }
  const row = (set: Awaited<ReturnType<typeof statementSet>>, name: string, label: string) => set.statements.find((s) => s.name === name)!.rows.find((r) => r.label.trim() === label)!.values;

  it("runs 1 Februari – 31 Agu 2026 against 1 Feb – 31 Agu 2025, with the Neraca against 31 Jan 2026", async () => {
    const set = await statementSet(db, await books(1), 2026, 8);
    const lr = set.statements.find((s) => s.name === "Laba Rugi")!;
    expect(lr.subtitle).toBe("Untuk periode 1 Februari – 31 Agu 2026, dibandingkan periode yang sama tahun buku sebelumnya");
    expect(lr.columns).toEqual(["1 Feb – 31 Agu 2026", "1 Feb – 31 Agu 2025"]);
    expect(row(set, "Laba Rugi", "Laba bersih")).toEqual([40n * J, 70n * J]);
    const nr = set.statements.find((s) => s.name === "Neraca")!;
    expect(nr.columns).toEqual(["31 Agu 2026", "31 Jan 2026"]);
    expect(row(set, "Neraca", "Laba (rugi) tahun berjalan")).toEqual([40n * J, 170n * J]);
    expect(row(set, "Neraca", "Saldo laba")).toEqual([170n * J, 0n]);
    expect(set.statements.find((s) => s.name === "Arus Kas")!.subtitle).toBe("Untuk periode 1 Februari – 31 Agu 2026");

  });

  it("January closes the year: 1 Feb 2025 – 31 Jan 2026, with the start year printed", async () => {
    const scope = await books(1);
    const set = await statementSet(db, scope, 2026, 1);
    expect(set.statements.find((s) => s.name === "Laba Rugi")!.columns[0]).toBe("1 Feb 2025 – 31 Jan 2026");
    expect(row(set, "Laba Rugi", "Laba bersih")[0]).toBe(170n * J);
    const notes = await financialNotes(db, scope, 2026, 1);
    expect(notes.notes[0].paragraphs[0]).toContain("untuk periode 1 Februari 2025 – 31 Jan 2026.");
  });

  it("a calendar-year client reads as before", async () => {
    const set = await statementSet(db, await books(12), 2026, 8);
    const lr = set.statements.find((s) => s.name === "Laba Rugi")!;
    expect([lr.subtitle, lr.columns]).toEqual(["Untuk periode 1 Januari – 31 Agu 2026, dibandingkan periode yang sama 2025", ["1 Jan – 31 Agu 2026", "1 Jan – 31 Agu 2025"]]);
    expect(row(set, "Laba Rugi", "Laba bersih")).toEqual([140n * J, 70n * J]);
  });
});
