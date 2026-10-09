import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { dateOnly } from "@/lib/format";
import { balanceSheet } from "@/lib/reports/ledger";
import { fixedAssetMovement } from "@/lib/reports/statements";
import { financialNotes } from "@/lib/reports/notes";
import { reverseEntry } from "@/lib/ledger/reverse";

/** PSAK 216's reconciliation of the carrying amount, from the GL: opening (Saldo Awal), purchase, depreciation, disposal → the Neraca. */
describe("fixed-asset movement schedule", () => {
  beforeEach(resetDb);

  it("rolls each account forward and the book value equals the Neraca; no separate note for the accumulation", async () => {
    const g = await makeGroup();
    const id = async (code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
    const bank = g.pt.banks[0].accountId;
    const post = (date: Date, kind: "OPENING" | "ADJUSTMENT", lines: [string, bigint, bigint][]) =>
      db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date, kind, memo: kind, lines: await Promise.all(lines.map(async ([c, d, k]) => ({ accountId: c === "bank" ? bank : await id(c), debit: d, credit: k }))) }));
    await post(dateOnly(2026, 2, 28), "OPENING", [["bank", 200_000_000n, 0n], ["1210", 100_000_000n, 0n], ["1219", 0n, 20_000_000n], ["3100", 0n, 280_000_000n]]);
    await post(dateOnly(2026, 3, 10), "ADJUSTMENT", [["1210", 50_000_000n, 0n], ["bank", 0n, 50_000_000n]]);
    for (const m of [3, 4, 5, 6]) await post(dateOnly(2026, m, 28), "ADJUSTMENT", [["6180", 3_000_000n, 0n], ["1219", 0n, 3_000_000n]]);
    // Disposal: cost 30 jt with 10 jt accumulated, sold for 15 jt → loss 5 jt.
    await post(dateOnly(2026, 6, 15), "ADJUSTMENT", [["1219", 10_000_000n, 0n], ["bank", 15_000_000n, 0n], ["7300", 5_000_000n, 0n], ["1210", 0n, 30_000_000n]]);
    const scope = { clientId: g.client.id, entityIds: [g.pt.entity.id] };

    const mv = await fixedAssetMovement(db, scope, dateOnly(2026, 6, 30));
    expect(mv.openedAt).toEqual(dateOnly(2026, 2, 28));
    expect(mv.rows.map((r) => [r.code, r.kind, r.opening, r.additions, r.deductions, r.closing])).toEqual([
      ["1210", "COST", 100_000_000n, 50_000_000n, -30_000_000n, 120_000_000n],
      ["1219", "ACCUMULATED", -20_000_000n, -12_000_000n, 10_000_000n, -22_000_000n],
    ]);
    for (const r of mv.rows) expect(r.opening + r.additions + r.deductions).toBe(r.closing);
    const bs = await balanceSheet(db, scope, dateOnly(2026, 6, 30));
    const onNeraca = bs.nonCurrentAssets.filter((i) => i.fsLine === "ASET_TETAP" || i.fsLine === "AKUM_PENYUSUTAN").reduce((t, i) => t + i.amount, 0n);
    expect(mv.rows.reduce((t, r) => t + r.closing, 0n)).toBe(onNeraca);

    const notes = await financialNotes(db, scope, 2026, 6);
    expect(notes.notes.find((n) => n.title === "Akumulasi penyusutan")).toBeUndefined();
    expect(notes.notes.map((n) => n.number)).toEqual(notes.notes.map((_, i) => String(i + 1)));
    const at = notes.notes.find((n) => n.title === "Aset tetap")!;
    expect(at.tables[0].columns).toEqual(["Uraian", "Saldo 28 Februari 2026", "Penambahan", "Pengurangan", "Saldo 30 Juni 2026"]);
    expect(at.tables[0].rows.map((r) => r[0])).toEqual(["Harga perolehan", "1210 Aset Tetap", "Akumulasi penyusutan", "1219 Akumulasi Penyusutan"]);
    expect(at.tables[0].total).toEqual(["Nilai buku", 80_000_000n, 38_000_000n, -20_000_000n, 98_000_000n]);
  });

  it("a manual entry reversed in the period is neither a purchase nor a disposal; a mistyped account stays out, as on the Neraca", async () => {
    const g = await makeGroup();
    const id = async (code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
    const bank = g.pt.banks[0].accountId;
    const post = (date: Date, lines: [string, bigint, bigint][]) =>
      db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date, kind: "ADJUSTMENT", memo: "uji", lines: await Promise.all(lines.map(async ([c, d, k]) => ({ accountId: c === "bank" ? bank : await id(c), debit: d, credit: k }))) }));
    await post(dateOnly(2026, 1, 5), [["bank", 100_000_000n, 0n], ["3100", 0n, 100_000_000n]]);
    await post(dateOnly(2026, 2, 10), [["1210", 40_000_000n, 0n], ["bank", 0n, 40_000_000n]]);
    // Booked to 1210 by mistake, reversed the next month.
    const wrong = await post(dateOnly(2026, 3, 10), [["1210", 7_000_000n, 0n], ["2110", 0n, 7_000_000n]]);
    await reverseEntry(db, { clientId: g.client.id, entryId: wrong.id, date: dateOnly(2026, 4, 1) });
    // An expense account someone put on the fixed-asset line: the Neraca shows it by its type, so the schedule leaves it out.
    const odd = await db.account.create({ data: { firmId: g.firm.id, clientId: g.client.id, code: "6999", name: "Beban salah petakan", type: "BEBAN", normalBalance: "DEBIT", fsLine: "ASET_TETAP" } });
    await db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 5, 2), kind: "ADJUSTMENT", memo: "uji", lines: [{ accountId: odd.id, debit: 1_000_000n }, { accountId: bank, credit: 1_000_000n }] }));
    const scope = { clientId: g.client.id, entityIds: [g.pt.entity.id] };
    const mv = await fixedAssetMovement(db, scope, dateOnly(2026, 6, 30));
    expect(mv.rows.map((r) => [r.code, r.opening, r.additions, r.deductions, r.closing])).toEqual([["1210", 0n, 40_000_000n, 0n, 40_000_000n]]);
    const bs = await balanceSheet(db, scope, dateOnly(2026, 6, 30));
    expect(bs.nonCurrentAssets.filter((i) => i.fsLine === "ASET_TETAP" || i.fsLine === "AKUM_PENYUSUTAN").reduce((t, i) => t + i.amount, 0n)).toBe(40_000_000n);
  });
});
