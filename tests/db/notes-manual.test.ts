import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { financialNotes, manualCount, MANUAL_MARK } from "@/lib/reports/notes";
import { postJournal } from "@/lib/ledger/post";
import { dateOnly } from "@/lib/format";

/** UC-K3: the CALK parts only management can write are marked and counted, so a statement isn't sent with a blank nobody saw. */
describe("CALK manual parts", () => {
  beforeEach(resetDb);

  it("marks the deed, address, business and events after the period; a person has no deed", async () => {
    const g = await makeGroup();
    const pt = await financialNotes(db, { clientId: g.client.id, entityIds: [g.pt.entity.id] }, 2026, 6);
    const umum = pt.notes[0].paragraphs.join("\n");
    expect(umum).toContain("Pendirian: [isi oleh manajemen: nomor dan tanggal akta pendirian");
    expect(umum).toContain("Alamat: [isi oleh manajemen:");
    expect(umum).toContain("Kegiatan usaha: [isi oleh manajemen:");
    const last = pt.notes.at(-1)!;
    expect([last.title, last.paragraphs[0].match(MANUAL_MARK)?.length]).toEqual(["Peristiwa setelah periode pelaporan", 1]);
    expect(last.paragraphs[0]).toContain("setelah 30 Jun 2026");
    expect(manualCount(pt)).toBe(4);

    const person = await financialNotes(db, { clientId: g.client.id, entityIds: [g.owner.entity.id] }, 2026, 6);
    expect(person.notes[0].paragraphs.join("\n")).not.toContain("Pendirian:");
    expect(manualCount(person)).toBe(3);

    // Combined: each entity's own lines, named.
    const both = await financialNotes(db, { clientId: g.client.id, entityIds: [g.pt.entity.id, g.owner.entity.id] }, 2026, 6);
    expect(manualCount(both)).toBe(6);
    expect(both.notes[0].paragraphs.some((p) => p.startsWith(`${g.pt.entity.name} — Pendirian:`))).toBe(true);
  });

  it("covers the months from the Saldo Awal when the books start inside the year, and the opening month as a position", async () => {
    const g = await makeGroup();
    const id = async (code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
    await db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 5, 31), kind: "OPENING", memo: "Saldo awal", lines: [{ accountId: g.pt.banks[0].accountId, debit: 100n }, { accountId: await id("3200"), credit: 100n }] }));
    const umum = async (month: number) => (await financialNotes(db, { clientId: g.client.id, entityIds: [g.pt.entity.id] }, 2026, month)).notes[0].paragraphs[0];
    expect(await umum(5)).toBe(`${g.pt.entity.name} ("Entitas") menyajikan laporan keuangan untuk posisi keuangan per 31 Mei 2026, saldo awal pembukuan.`);
    expect(await umum(8)).toBe(`${g.pt.entity.name} ("Entitas") menyajikan laporan keuangan untuk periode 1 Juni – 31 Agu 2026.`);
  });
});
