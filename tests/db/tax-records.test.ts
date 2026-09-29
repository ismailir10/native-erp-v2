import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { taxPack } from "@/lib/tax/pack";
import { acceptSuggestion, addCorrection, addCredit, deleteCorrection, deleteCredit, dismissSuggestion, setRegime } from "@/lib/tax/records";
import { dateOnly } from "@/lib/format";

type G = Awaited<ReturnType<typeof makeGroup>>;
const acc = async (g: G, code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
const journal = async (g: G, date: Date, dr: string, cr: string, amount: bigint) =>
  db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date, kind: "ADJUSTMENT", memo: "uji", lines: [{ accountId: await acc(g, dr), debit: amount }, { accountId: await acc(g, cr), credit: amount }] }));
const at = (g: G, month = 9) => taxPack(db, g.client.id, g.pt.entity.id, 2026, month).then((p) => p!);

describe("tax pack records", () => {
  beforeEach(resetDb);

  it("adds and removes manual corrections and credits, and switches the regime", async () => {
    const g = await makeGroup();
    await journal(g, dateOnly(2026, 3, 31), "1130", "4100", 1_000_000_000n);
    const base = { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026 };
    const c = await addCorrection(db, { ...base, description: "Biaya jamuan tanpa daftar nominatif", direction: "POSITIVE", kind: "PERMANENT", amount: "12.500.000" });
    await addCorrection(db, { ...base, description: "Penyisihan piutang", direction: "POSITIVE", kind: "TEMPORARY", amount: "3000000", accountCode: "1130" });
    expect((await at(g)).positive).toBe(15_500_000n);
    await deleteCorrection(db, { clientId: g.client.id, correctionId: c.id });
    expect((await at(g)).positive).toBe(3_000_000n);

    const cr = await addCredit(db, { ...base, type: "PPH_23", reference: "BP-77", date: "2026-05-05", amount: "4000000", accountCode: "1180" });
    expect((await at(g)).settlement?.credits).toBe(4_000_000n);
    expect((await at(g, 4)).settlement?.credits).toBe(0n); // dated after April
    await deleteCredit(db, { clientId: g.client.id, creditId: cr.id });
    expect((await at(g)).credits).toEqual([]);

    await setRegime(db, { ...base, regime: "FINAL_UMKM" });
    expect((await at(g)).tax.due).toBe(5_000_000n);
  });

  it("accepts a suggestion as a correction that follows its account, or dismisses it for good", async () => {
    const g = await makeGroup();
    await db.account.create({ data: { firmId: g.firm.id, clientId: g.client.id, code: "6195", name: "Beban Sumbangan", type: "BEBAN", normalBalance: "DEBIT", fsLine: "BEBAN_UMUM_ADM" } });
    await db.account.create({ data: { firmId: g.firm.id, clientId: g.client.id, code: "6196", name: "Denda Pajak", type: "BEBAN", normalBalance: "DEBIT", fsLine: "BEBAN_UMUM_ADM" } });
    await journal(g, dateOnly(2026, 2, 28), "6195", "1110", 5_000_000n);
    await journal(g, dateOnly(2026, 2, 28), "6196", "1110", 700_000n);
    const base = { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026 };
    expect((await at(g)).suggestions.map((s) => s.key)).toEqual(["nd:6195", "nd:6196"]);
    await acceptSuggestion(db, { ...base, accountCode: "6195", amount: 5_000_000n });
    await dismissSuggestion(db, { ...base, key: "nd:6196" });
    let p = await at(g);
    expect(p.suggestions).toEqual([]);
    expect(p.positive).toBe(5_000_000n);
    // Another donation later in the year: the accepted correction follows the account.
    await journal(g, dateOnly(2026, 8, 15), "6195", "1110", 2_000_000n);
    p = await at(g);
    expect(p.positive).toBe(7_000_000n);
    await expect(acceptSuggestion(db, { ...base, accountCode: "6195", amount: 1n })).rejects.toThrow(/sudah diterima/);
    await expect(acceptSuggestion(db, { ...base, accountCode: "6100", amount: 1n })).rejects.toThrow(/tidak berlaku/);
  });

  it("refuses individuals, bad input and a locked December", async () => {
    const g = await makeGroup();
    const base = { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026 };
    await expect(addCorrection(db, { ...base, entityId: g.owner.entity.id, description: "x", direction: "POSITIVE", kind: "PERMANENT", amount: "1" })).rejects.toThrow(/badan usaha/);
    await expect(addCorrection(db, { ...base, description: " ", direction: "POSITIVE", kind: "PERMANENT", amount: "1" })).rejects.toThrow(/keterangan/);
    await expect(addCredit(db, { ...base, type: "PPH_23", reference: "BP-1", date: "2025-12-31", amount: "1", accountCode: "1180" })).rejects.toThrow(/tahun 2026/);
    await expect(addCredit(db, { ...base, type: "PPH_23", reference: "BP-1", date: "2026-05-05", amount: "1", accountCode: "1101" })).rejects.toThrow(/1180/);
    await db.period.create({ data: { firmId: g.firm.id, clientId: g.client.id, year: 2026, month: 12, status: "LOCKED" } });
    await expect(setRegime(db, { ...base, regime: "FINAL_UMKM" })).rejects.toThrow(/Desember 2026 sudah dikunci/);
  });
});
