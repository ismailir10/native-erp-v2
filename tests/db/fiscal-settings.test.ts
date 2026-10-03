import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { EntitySettingsError, setFiscalYearEnd } from "@/lib/entity-settings";
import { fiscalEndMonth } from "@/lib/fiscal";
import { listEvents } from "@/lib/audit";

describe("tahun buku setting", () => {
  beforeEach(resetDb);

  it("saves the year end with its history, refuses a bad month, and freezes once a month is closed", async () => {
    const g = await makeGroup();
    expect(await fiscalEndMonth(db, g.client.id)).toBe(12);
    await setFiscalYearEnd(db, { clientId: g.client.id, endMonth: 1 });
    expect(await fiscalEndMonth(db, g.client.id)).toBe(1);
    expect((await listEvents(db, g.client.id, { kind: "FISCAL_YEAR" })).map((e) => e.summary)).toEqual(["Tahun buku diubah: 1 Januari – 31 Desember → 1 Februari – 31 Januari"]);
    await expect(setFiscalYearEnd(db, { clientId: g.client.id, endMonth: 13 })).rejects.toThrow(EntitySettingsError);
    await expect(db.client.update({ where: { id: g.client.id }, data: { fiscalYearEndMonth: 0 } })).rejects.toThrow();

    await db.period.create({ data: { firmId: g.firm.id, clientId: g.client.id, year: 2026, month: 3, status: "LOCKED", lockedAt: new Date() } });
    await expect(setFiscalYearEnd(db, { clientId: g.client.id, endMonth: 6 })).rejects.toThrow("Tahun buku tidak bisa diubah setelah ada bulan yang ditutup (Maret 2026). Buka kunci bulannya dulu.");
    // The same value is a no-op, not a refusal.
    await setFiscalYearEnd(db, { clientId: g.client.id, endMonth: 1 });
    expect(await fiscalEndMonth(db, g.client.id)).toBe(1);
  });
});
