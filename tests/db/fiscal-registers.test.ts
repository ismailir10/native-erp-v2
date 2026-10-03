import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { postInstallment } from "@/lib/adjust/schedules";
import { assetRegister, createAsset } from "@/lib/assets/register";
import { registerViews } from "@/lib/assets/view";
import { importCensus, saveBenefitSetting, uploadMortality } from "@/lib/benefits/census";
import { valuation } from "@/lib/benefits/valuation";
import { runControls } from "@/lib/controls";
import { setRegime } from "@/lib/tax/records";
import { postTax } from "@/lib/tax/post";
import { financialNotes } from "@/lib/reports/notes";
import { dateOnly } from "@/lib/format";
import { CENSUS_CSV, mortalityCsv } from "../benefits-fixture";

type G = Awaited<ReturnType<typeof makeGroup>>;
const acc = async (g: G, code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
const yearEnd = (g: G, endMonth: number) => db.client.update({ where: { id: g.client.id }, data: { fiscalYearEndMonth: endMonth } });

/** Registers and close controls count "the year" by the client's tahun buku; Pajak Badan says it is calendar-only instead of guessing. */
describe("financial year in registers and controls", () => {
  beforeEach(resetDb);

  it("asset register: depreciation to date runs from 1 February for a 31 January year end; tax depreciation is left out", async () => {
    const run = async (endMonth: number) => {
      const g = await makeGroup();
      await yearEnd(g, endMonth);
      const entry = await db.$transaction(async (tx) =>
        postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 8, 10), kind: "ADJUSTMENT", memo: "Beli mesin", lines: [{ accountId: await acc(g, "1210"), debit: 12_000_000n }, { accountId: await acc(g, "2110"), credit: 12_000_000n }] }),
      );
      const a = await createAsset(db, { clientId: g.client.id, entityId: g.pt.entity.id, name: "Mesin jahit", taxGroup: "KELOMPOK_1", fiscalMethod: "GARIS_LURUS", acquiredOn: "2026-08-10", cost: "12000000", usefulLifeMonths: 12, assetAccountCode: "1210", sourceEntryId: entry.id });
      for (const k of [1, 2, 3, 4, 5, 6]) await postInstallment(db, { clientId: g.client.id, scheduleId: a.scheduleId!, k }); // Sep 2026 – Feb 2027
      const at = async (y: number, m: number) => (await assetRegister(db, g.client.id, y, m))[0];
      // The page's totals: no tax-depreciation column (of zeros) where the register computed none.
      const view = (await registerViews(db, g.client.id, 2027, 1, [{ id: g.pt.entity.id, name: g.pt.entity.name, shortName: g.pt.entity.shortName, functionalCurrency: "IDR", kind: "PT" }]))[0];
      return { jan: await at(2027, 1), feb: await at(2027, 2), totals: view.totals };
    };
    const chickin = await run(1);
    expect([chickin.jan.bookYtd, chickin.feb.bookYtd, chickin.jan.fiscalYtd]).toEqual([5_000_000n, 1_000_000n, null]);
    expect([chickin.totals.fiscalYtd, chickin.totals.difference]).toEqual([null, null]);
    const calendar = await run(12);
    expect([calendar.jan.bookYtd, calendar.feb.bookYtd]).toEqual([1_000_000n, 2_000_000n]);
    expect([calendar.jan.fiscalYtd, calendar.totals.fiscalYtd]).not.toContain(null);
  });

  it("benefits: a June year end opens at 30 June, takes six months of cost by December, and is checked in June", async () => {
    const g = await makeGroup();
    await yearEnd(g, 6);
    const table = await uploadMortality(db, { firmId: g.firm.id, name: "Tabel uji", fileName: "t.csv", data: mortalityCsv() });
    await importCensus(db, { clientId: g.client.id, entityId: g.pt.entity.id, fileName: "s.csv", data: Buffer.from(CENSUS_CSV) });
    await saveBenefitSetting(db, { clientId: g.client.id, entityId: g.pt.entity.id, mortalityTableId: table.id, discount: "7", salary: "5", retirementAge: 56, disability: "10", resign: "5", resignFlatUntil: 30, resignZeroAge: 55 });
    const v = await valuation(db, g.client.id, g.pt.entity.id, 2026, 12);
    expect(v.opening.at.toISOString().slice(0, 10)).toBe("2026-06-30");
    const annual = v.opening.serviceCost + v.opening.interestCost;
    // July–December: half the opening valuation's annual cost (nobody was hired after 30 June 2026).
    expect(v.expenseTarget).toBe((annual * 6n * 2n + 12n) / 24n);
    const eb = (y: number, m: number) => runControls(db, g.client.id, y, m).then((cs) => cs.some((c) => c.key === `eb:${g.pt.entity.id}`));
    expect([await eb(2026, 12), await eb(2027, 6)]).toEqual([false, true]);
  });

  it("Pajak Badan: refused for a non-calendar tahun buku, no December tax control, and the CALK leaves the note to management", async () => {
    const g = await makeGroup();
    await yearEnd(g, 1);
    await db.$transaction(async (tx) =>
      postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 12, 10), kind: "ADJUSTMENT", memo: "uji", lines: [{ accountId: await acc(g, "1110"), debit: 90_000_000n }, { accountId: await acc(g, "4100"), credit: 90_000_000n }] }),
    );
    const msg = "Pajak Badan untuk tahun buku non-kalender belum didukung di Buku.";
    await expect(setRegime(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, regime: "NORMAL" })).rejects.toThrow(msg);
    await expect(postTax(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month: 12, kind: "CURRENT" })).rejects.toThrow(msg);
    expect((await runControls(db, g.client.id, 2026, 12)).some((c) => c.key.startsWith("tax:"))).toBe(false);
    const note = (await financialNotes(db, { clientId: g.client.id, entityIds: [g.pt.entity.id] }, 2026, 12)).notes.find((n) => n.title === "Pajak penghasilan")!;
    expect(note.paragraphs[0]).toBe("[isi oleh manajemen: rekonsiliasi laba komersial ke laba fiskal dan PPh badan tahun buku ini; Buku belum menghitung Pajak Badan untuk tahun buku 1 Februari – 31 Januari]");
  });
});
