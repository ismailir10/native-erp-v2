import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postOpening } from "@/lib/opening";
import { FindingError, listFindings, resolveOpeningFinding } from "@/lib/findings";
import { trialBalance } from "@/lib/reports/ledger";
import { dateOnly } from "@/lib/format";

/** Temuan (ADR 0012): an opening difference is resolved once, in writing, by an OPENING entry that empties 3290. */
describe("Temuan selisih saldo awal", () => {
  beforeEach(resetDb);
  const date = dateOnly(2026, 3, 31);
  const net = async (clientId: string, entityId: string, code: string) => (await trialBalance(db, { clientId, entityIds: [entityId] }, dateOnly(2026, 3, 31))).find((r) => r.account.code === code)?.net ?? 0n;

  it("numbers per client, resolves to the decided account dated the Saldo Awal, keeps the decision and refuses a second resolution", async () => {
    const g = await makeGroup();
    const a = await postOpening(db, { clientId: g.client.id, entityId: g.pt.entity.id, date, lines: [{ accountCode: "1101", debit: "940.000.000", credit: "" }, { accountCode: "3100", debit: "", credit: "1.000.000.000" }] });
    const b = await postOpening(db, { clientId: g.client.id, entityId: g.owner.entity.id, date, lines: [{ accountCode: "1103", debit: "5.000.000", credit: "" }] });
    expect([a.finding?.label, b.finding?.label]).toEqual(["T-001", "T-002"]);
    expect(a.finding?.amount).toBe(60_000_000n); // credits exceed debits: the difference sits on the debit side of 3290
    expect(await net(g.client.id, g.pt.entity.id, "3290")).toBe(60_000_000n);

    const base = { clientId: g.client.id, findingId: a.finding!.id, accountCode: "1110" };
    await expect(resolveOpeningFinding(db, { ...base, decision: "kas kecil" })).rejects.toThrow(/min\. 10 karakter/);
    await expect(resolveOpeningFinding(db, { ...base, accountCode: "1101", decision: "Kas kecil di brankas" })).rejects.toThrow(/rekening koran/);
    await expect(resolveOpeningFinding(db, { ...base, accountCode: "1999", decision: "Kas kecil di brankas" })).rejects.toBeInstanceOf(FindingError);
    await resolveOpeningFinding(db, { ...base, decision: "Kas kecil di brankas, dikonfirmasi pemilik 2 Okt" });

    expect(await net(g.client.id, g.pt.entity.id, "3290")).toBe(0n);
    expect(await net(g.client.id, g.pt.entity.id, "1110")).toBe(60_000_000n);
    const entries = await db.journalEntry.findMany({ where: { entityId: g.pt.entity.id }, orderBy: { createdAt: "asc" } });
    expect(entries.map((e) => [e.kind, e.date.toISOString().slice(0, 10)])).toEqual([["OPENING", "2026-03-31"], ["OPENING", "2026-03-31"]]);
    expect(entries[1].memo).toBe("Penyelesaian T-001: Kas kecil di brankas, dikonfirmasi pemilik 2 Okt");

    const [t1, t2] = [...(await listFindings(db, g.client.id))].sort((x, y) => x.label.localeCompare(y.label));
    expect(t1).toMatchObject({ status: "RESOLVED", resolution: "Kas kecil di brankas, dikonfirmasi pemilik 2 Okt", resolvedTo: "1110 Kas Kecil", entity: "PT Uji" });
    expect(t2).toMatchObject({ status: "OPEN", resolution: null, entity: "Andi" });
    await expect(resolveOpeningFinding(db, { ...base, decision: "Kas kecil di brankas lagi" })).rejects.toThrow("T-001 sudah diselesaikan.");
  });

  it("records the decision without an entry when another journal already emptied 3290, and the DB refuses a resolved row without a decision", async () => {
    const g = await makeGroup();
    const { finding } = await postOpening(db, { clientId: g.client.id, entityId: g.pt.entity.id, date, lines: [{ accountCode: "1101", debit: "1.000", credit: "" }] });
    // Cleared by hand before the decision was written down.
    const acc = async (code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
    const { postJournal } = await import("@/lib/ledger/post");
    await db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 4, 2), kind: "ADJUSTMENT", memo: "Koreksi", lines: [{ accountId: await acc("3290"), debit: 1_000n }, { accountId: await acc("3100"), credit: 1_000n }] }));
    const r = await resolveOpeningFinding(db, { clientId: g.client.id, findingId: finding!.id, accountCode: "3100", decision: "Sudah dikoreksi ke modal lewat jurnal 2 April" });
    expect(r.resolvedEntryId).toBeNull();
    await expect(db.$executeRawUnsafe(`UPDATE "Finding" SET resolution = NULL WHERE id = '${finding!.id}'`)).rejects.toThrow(/Finding_resolution_check/);
  });

  it("refuses to post the resolution into a closed month", async () => {
    const g = await makeGroup();
    const { finding } = await postOpening(db, { clientId: g.client.id, entityId: g.pt.entity.id, date, lines: [{ accountCode: "1101", debit: "1.000", credit: "" }] });
    await db.period.update({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month: 3 } }, data: { status: "LOCKED" } });
    await expect(resolveOpeningFinding(db, { clientId: g.client.id, findingId: finding!.id, accountCode: "3100", decision: "Setoran modal awal pemilik" })).rejects.toThrow(/sudah ditutup/);
    expect((await db.finding.findUniqueOrThrow({ where: { id: finding!.id } })).status).toBe("OPEN");
  });
});
