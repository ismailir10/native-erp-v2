import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postOpening } from "@/lib/opening";
import { resolveOpeningFinding } from "@/lib/findings";
import { lockPeriod, runControls } from "@/lib/controls";
import { postJournal } from "@/lib/ledger/post";
import { reverseEntry } from "@/lib/ledger/reverse";
import { dateOnly } from "@/lib/format";

/** ADR 0012: the close reads 3290 in the GL; an entity whose books start without a Saldo Awal is asked about it once. */
describe("kontrol saldo awal", () => {
  beforeEach(resetDb);
  const acc = async (clientId: string, code: string) => (await db.account.findFirstOrThrow({ where: { clientId, code } })).id;

  it("opening-diff FAILs every month until the Temuan is decided, and again if the decision is undone by a later journal", async () => {
    const g = await makeGroup();
    const { finding } = await postOpening(db, { clientId: g.client.id, entityId: g.pt.entity.id, date: dateOnly(2026, 3, 31), lines: [{ accountCode: "1101", debit: "1.000.000", credit: "" }] });
    for (const m of [4, 5]) {
      const c = (await runControls(db, g.client.id, 2026, m)).find((x) => x.key === `opening-diff:${g.pt.entity.id}`);
      expect(c).toMatchObject({ status: "FAIL", detail: "Rp 1.000.000 di 3290 Selisih Saldo Awal (temuan T-001). Tulis asal selisihnya dan pilih akunnya di Temuan." });
    }
    await expect(lockPeriod(db, g.client.id, 2026, 4, "tutup")).rejects.toThrow(/kontrol gagal/);

    await resolveOpeningFinding(db, { clientId: g.client.id, findingId: finding!.id, accountCode: "3100", decision: "Setoran modal awal pemilik, akta 2025" });
    expect((await runControls(db, g.client.id, 2026, 4)).some((x) => x.key.startsWith("opening-diff:"))).toBe(false);

    // A later adjustment that puts money back on 3290 (here: moving it off Modal by hand) fails the close again — the GL decides.
    const adj = await db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 5, 3), kind: "ADJUSTMENT", memo: "Salah pindah", lines: [{ accountId: await acc(g.client.id, "3100"), debit: 1_000_000n }, { accountId: await acc(g.client.id, "3290"), credit: 1_000_000n }] }));
    expect((await runControls(db, g.client.id, 2026, 4)).some((x) => x.key.startsWith("opening-diff:"))).toBe(false); // April is before it
    expect((await runControls(db, g.client.id, 2026, 5)).find((x) => x.key === `opening-diff:${g.pt.entity.id}`)?.status).toBe("FAIL");
    await reverseEntry(db, { clientId: g.client.id, entryId: adj.id, date: dateOnly(2026, 5, 4) });
    expect((await runControls(db, g.client.id, 2026, 5)).some((x) => x.key.startsWith("opening-diff:"))).toBe(false);
  });

  it("asks once, in the month the books start, when an entity has entries but no Saldo Awal", async () => {
    const g = await makeGroup();
    const post = async (d: Date) =>
      db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date: d, kind: "ADJUSTMENT", memo: "Beban", lines: [{ accountId: await acc(g.client.id, "6100"), debit: 5n }, { accountId: await acc(g.client.id, "2150"), credit: 5n }] }));
    await post(dateOnly(2026, 4, 10));
    await post(dateOnly(2026, 5, 10));
    const april = (await runControls(db, g.client.id, 2026, 4)).find((c) => c.key === `opening:${g.pt.entity.id}`);
    expect(april).toMatchObject({ status: "REVIEW", detail: expect.stringContaining("neraca dimulai dari nol") });
    expect((await runControls(db, g.client.id, 2026, 5)).some((c) => c.key === `opening:${g.pt.entity.id}`)).toBe(false);
    // The owner has no entries at all: nothing to ask.
    expect((await runControls(db, g.client.id, 2026, 4)).some((c) => c.key === `opening:${g.owner.entity.id}`)).toBe(false);
  });

  it("doesn't ask an entity booked by a ledger import, which brings its own opening rows", async () => {
    const g = await makeGroup();
    await db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 4, 10), kind: "IMPORTED", memo: "GL", lines: [{ accountId: await acc(g.client.id, "6100"), debit: 5n }, { accountId: await acc(g.client.id, "2150"), credit: 5n }] }));
    expect((await runControls(db, g.client.id, 2026, 4)).some((c) => c.key === `opening:${g.pt.entity.id}`)).toBe(false);
  });

  it("posts one Saldo Awal and one Temuan when two saves race", async () => {
    const g = await makeGroup();
    const save = () => postOpening(db, { clientId: g.client.id, entityId: g.pt.entity.id, date: dateOnly(2026, 3, 31), lines: [{ accountCode: "1101", debit: "1.000", credit: "" }] });
    const results = await Promise.allSettled([save(), save()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.journalEntry.count({ where: { entityId: g.pt.entity.id, kind: "OPENING" } })).toBe(1);
    expect(await db.finding.count()).toBe(1);
  });
});
