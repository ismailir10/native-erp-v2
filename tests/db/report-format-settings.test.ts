import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { loadReportFormat, standardFormat } from "@/lib/reports/format";
import { formatUniverse, resetReportFormat, saveReportFormat } from "@/lib/reports/format-settings";
import { listEvents } from "@/lib/audit";

/** UC-K3: *Format laporan* in client settings — saved only when it checks, recorded in the history, reset to standard; other clients untouched. */
describe("report format settings", () => {
  beforeEach(resetDb);

  it("saves a checked format, refuses a broken one naming the line, and resets to the standard", async () => {
    const g = await makeGroup();
    const other = await makeGroup();
    const member = await db.firmMember.create({ data: { firmId: g.firm.id, userId: randomUUID(), email: `a-${randomUUID()}@example.test`, name: "Akuntan Uji", role: "AKUNTAN" } });
    const mine = standardFormat();
    mine.unit = "RIBUAN";
    mine.source = "  Laporan Keuangan 2025 final  ";
    mine.labaRugi = mine.labaRugi.map((l) => (l.key === "laba_bersih" ? { ...l, label: "LABA BERSIH" } : l));
    await saveReportFormat(db, { clientId: g.client.id, actorId: member.id, format: mine });
    const saved = await loadReportFormat(db, g.client.id);
    expect([saved.custom, saved.unit, saved.source, saved.labaRugi.at(-1)!.label]).toEqual([true, "RIBUAN", "Laporan Keuangan 2025 final", "LABA BERSIH"]);
    expect((await loadReportFormat(db, other.client.id)).custom).toBe(false);

    // A Pos that drops its Buku line is refused, naming it; the saved format stays.
    const broken = structuredClone(mine);
    broken.neraca = broken.neraca.filter((l) => l.key !== "persediaan").map((l) => (l.kind === "TOTAL" ? { ...l, terms: l.terms.filter((t) => t.key !== "persediaan") } : l));
    await expect(saveReportFormat(db, { clientId: g.client.id, actorId: member.id, format: broken })).rejects.toThrow(/Neraca: Persediaan belum ada di format/);
    await expect(saveReportFormat(db, { clientId: g.client.id, format: { unit: "RIBUAN" } })).rejects.toThrow(/Format laporan tidak terbaca/);
    expect((await loadReportFormat(db, g.client.id)).unit).toBe("RIBUAN");

    await resetReportFormat(db, { clientId: g.client.id, actorId: member.id });
    expect((await loadReportFormat(db, g.client.id)).custom).toBe(false);
    expect((await listEvents(db, g.client.id, { kind: "REPORT_FORMAT" })).map((e) => e.summary)).toEqual([
      "Format laporan kembali ke standar",
      "Format laporan disimpan (sumber: Laporan Keuangan 2025 final)",
    ]);
  });

  it("offers every line each statement must place, by name", () => {
    const u = formatUniverse();
    expect(u.labaRugi.map((x) => x.line)).toContain("UNMAPPED_EXPENSE");
    expect(u.neraca.find((x) => x.line === "LABA_BERJALAN")!.label).toBeTruthy();
  });
});
