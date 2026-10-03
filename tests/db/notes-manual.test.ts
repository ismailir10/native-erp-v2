import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { financialNotes, manualCount, MANUAL_MARK } from "@/lib/reports/notes";

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
});
