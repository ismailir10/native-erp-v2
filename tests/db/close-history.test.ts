import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { CLOSE_SIGNOFFS, CloseError, runControls } from "@/lib/controls";
import { closeHistoryMonth, historyMonths, historyPreview } from "@/lib/controls/history";
import { saveControlNote } from "@/lib/controls/ack";
import { dateOnly } from "@/lib/format";

const session = vi.hoisted(() => ({ role: "ADMIN" as "ADMIN" | "AKUNTAN", firmId: "", memberId: "" }));
vi.mock("@/lib/tenant", async () => {
  const { db } = await import("../helpers");
  return {
    getCurrentFirm: async () => ({ id: session.firmId }),
    getCurrentMember: async () => ({ id: session.memberId, role: session.role }),
    getClientForFirm: async (id: string) => {
      const c = await db.client.findFirst({ where: { id, firmId: session.firmId }, include: { entities: true } });
      if (!c) throw new Error("Klien tidak ditemukan");
      return c;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { closeHistoryMonthAction, historyPreviewAction } = await import("@/app/actions");

type G = Awaited<ReturnType<typeof makeGroup>>;
const member = (g: G, role: "ADMIN" | "AKUNTAN", name: string) => db.firmMember.create({ data: { firmId: g.firm.id, userId: randomUUID(), email: `${name}@example.test`, name, role } });
const id = async (g: G, code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
/** A balanced entry in the month: sales into the bank (debit first) or, with `spend`, an expense paid from it. */
async function entry(g: G, month: number, opts: { kind?: "ADJUSTMENT" | "OPENING"; spend?: bigint } = {}) {
  const [dr, cr] = opts.spend ? ["6100", "1120"] : ["1120", "4100"];
  const amount = opts.spend ?? 1000n;
  return db.$transaction(async (tx) =>
    postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, month, opts.kind === "OPENING" ? 1 : 10), kind: opts.kind ?? "ADJUSTMENT", memo: `Uji ${month}`, lines: [{ accountId: await id(g, dr), debit: amount }, { accountId: await id(g, cr), credit: amount }] }),
  );
}
const status = async (g: G, month: number) => (await db.period.findUniqueOrThrow({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month } } })).status;
const NOTE = "Riwayat dari sistem lama, sudah ditutup di sana";

describe("closing the history in one pass", () => {
  beforeEach(resetDb);

  it("previews the open months before the selected one and closes them in order with one note", async () => {
    const g = await makeGroup();
    const admin = await member(g, "ADMIN", "admin");
    await entry(g, 1, { kind: "OPENING" });
    for (const m of [3, 4, 5]) await entry(g, m);
    // A month with only the Saldo Awal is not a month to close; the selected month (May) is not part of the run.
    expect(await historyMonths(db, g.client.id, { year: 2026, month: 5 })).toEqual([{ year: 2026, month: 3 }, { year: 2026, month: 4 }]);

    const p = await historyPreview(db, g.client.id, { year: 2026, month: 5 });
    expect(p.months.map((m) => [m.label, m.status])).toEqual([["Maret 2026", "NOTE"], ["April 2026", "NOTE"]]);
    expect(p.blocked).toBeNull();
    expect(p.groups.find((x) => x.title === "Rekonsiliasi BCA Giro")).toEqual({ title: "Rekonsiliasi BCA Giro", scope: "PT Uji", months: 2 });

    // Out of order: April waits for March (lockPeriod's own rule).
    await expect(closeHistoryMonth(db, { clientId: g.client.id, until: { year: 2026, month: 5 }, month: { year: 2026, month: 4 }, note: NOTE, fingerprint: p.months[1].fingerprint, actor: admin }))
      .rejects.toThrow(/Tutup buku Maret 2026 dulu/);
    expect(await db.controlAck.count()).toBe(0); // refused before anything is written
    for (const m of p.months) await closeHistoryMonth(db, { clientId: g.client.id, until: { year: 2026, month: 5 }, month: m, note: NOTE, fingerprint: m.fingerprint, actor: admin });
    expect([await status(g, 3), await status(g, 4), await status(g, 5)]).toEqual(["LOCKED", "LOCKED", "OPEN"]);

    // Rule 23 holds per month: every REVIEW carries the note, every sign-off is the admin's, the lock note says how.
    const march = await db.period.findUniqueOrThrow({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month: 3 } }, include: { acks: true, signoffs: true } });
    const reviews = (await runControls(db, g.client.id, 2026, 3)).filter((c) => c.status === "REVIEW");
    expect(reviews.length).toBeGreaterThan(0);
    expect(reviews.every((c) => c.ack === NOTE)).toBe(true);
    expect(march.signoffs.map((s) => [s.key, s.doneById]).sort()).toEqual(CLOSE_SIGNOFFS.map((s) => [s.key, admin.id]).sort());
    expect(march.lockNote).toBe(`Ditutup bersama bulan-bulan sebelumnya: ${NOTE}`);
    expect(march.lockedById).toBe(admin.id);
    const events = await db.auditEvent.findMany({ where: { clientId: g.client.id }, orderBy: { createdAt: "asc" } });
    expect(events.filter((e) => e.kind === "HISTORY_CLOSE").map((e) => e.summary)).toEqual([
      `Maret 2026 ditutup bersama bulan-bulan sebelumnya (${march.acks.length} kontrol diberi catatan): ${NOTE}`,
      expect.stringMatching(/^April 2026 ditutup bersama/),
    ]);
    expect(events.filter((e) => e.kind === "CONTROL_NOTE").length).toBeGreaterThanOrEqual(march.acks.length);
    // Nothing left to close before May.
    expect((await historyPreview(db, g.client.id, { year: 2026, month: 5 })).months).toEqual([]);
  });

  it("keeps a note already written and refuses a month whose controls changed since the check", async () => {
    const g = await makeGroup();
    const admin = await member(g, "ADMIN", "admin");
    for (const m of [3, 4, 5]) await entry(g, m);
    const p = await historyPreview(db, g.client.id, { year: 2026, month: 5 });
    const march = p.months[0];
    // Someone writes a note on one control after the check: the set to answer changed.
    const period = await db.period.findUniqueOrThrow({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month: 3 } } });
    const first = march.toNote[0];
    await saveControlNote(db, { clientId: g.client.id, periodId: period.id, year: 2026, month: 3, controlKey: first.key, note: "Rekening dibuka April", detail: first.detail, actorId: admin.id });
    await expect(closeHistoryMonth(db, { clientId: g.client.id, until: { year: 2026, month: 5 }, month: march, note: NOTE, fingerprint: march.fingerprint, actor: admin }))
      .rejects.toThrow(new CloseError("Kontrol Maret 2026 berubah sejak diperiksa. Periksa ulang."));
    expect(await status(g, 3)).toBe("OPEN");
    const again = (await historyPreview(db, g.client.id, { year: 2026, month: 5 })).months[0];
    expect(again.toNote.map((c) => c.key)).not.toContain(first.key);
    await closeHistoryMonth(db, { clientId: g.client.id, until: { year: 2026, month: 5 }, month: again, note: NOTE, fingerprint: again.fingerprint, actor: admin });
    expect((await db.controlAck.findUniqueOrThrow({ where: { periodId_controlKey: { periodId: period.id, controlKey: first.key } } })).note).toBe("Rekening dibuka April");
  });

  it("stops at the first month with a failed control and says how many months wait behind it", async () => {
    const g = await makeGroup();
    const admin = await member(g, "ADMIN", "admin");
    await entry(g, 3);
    await entry(g, 4, { spend: 5_000_000n }); // pays more than the bank ever held: total assets below zero = FAIL
    await entry(g, 5, { kind: "ADJUSTMENT" });
    await entry(g, 6);
    const p = await historyPreview(db, g.client.id, { year: 2026, month: 7 });
    expect(p.months.map((m) => [m.label, m.status])).toEqual([["Maret 2026", "NOTE"], ["April 2026", "FAIL"]]);
    expect(p.months[1].fails.length).toBeGreaterThan(0);
    expect(p.blocked).toEqual({ count: 2, from: "Mei 2026" });
    await closeHistoryMonth(db, { clientId: g.client.id, until: { year: 2026, month: 7 }, month: p.months[0], note: NOTE, fingerprint: p.months[0].fingerprint, actor: admin });
    await expect(closeHistoryMonth(db, { clientId: g.client.id, until: { year: 2026, month: 7 }, month: p.months[1], note: NOTE, fingerprint: p.months[1].fingerprint, actor: admin }))
      .rejects.toThrow(/^April 2026: \d+ kontrol gagal/);
    expect([await status(g, 3), await status(g, 4)]).toEqual(["LOCKED", "OPEN"]);
  });

  it("refuses an akuntan, a short note, the selected month itself and a month already closed", async () => {
    const g = await makeGroup();
    const admin = await member(g, "ADMIN", "admin");
    const akuntan = await member(g, "AKUNTAN", "akuntan");
    for (const m of [3, 4, 5]) await entry(g, m);
    const [march] = (await historyPreview(db, g.client.id, { year: 2026, month: 5 })).months;
    const run = (over: Partial<Parameters<typeof closeHistoryMonth>[1]>) =>
      closeHistoryMonth(db, { clientId: g.client.id, until: { year: 2026, month: 5 }, month: march, note: NOTE, fingerprint: march.fingerprint, actor: admin, ...over });
    await expect(run({ actor: akuntan })).rejects.toThrow("Hanya admin kantor yang dapat menutup beberapa bulan sekaligus.");
    await expect(run({ note: "ok sudah" })).rejects.toThrow(/min\. 10 karakter/);
    await expect(run({ month: { year: 2026, month: 5 } })).rejects.toThrow(/Mei 2026 bukan bulan sebelum Mei 2026/);
    await run({});
    await expect(run({})).rejects.toThrow("Maret 2026 sudah ditutup.");
  });

  it("server actions: tenant-scoped, admin only, and the preview is what the card reads", async () => {
    const g = await makeGroup();
    const admin = await member(g, "ADMIN", "admin");
    const akuntan = await member(g, "AKUNTAN", "akuntan");
    for (const m of [3, 4, 5]) await entry(g, m);
    Object.assign(session, { firmId: g.firm.id, memberId: akuntan.id, role: "AKUNTAN" });
    const r = await historyPreviewAction(g.client.id, 2026, 5);
    if (!r.ok) throw new Error(r.error);
    expect(r.preview.months).toHaveLength(2);
    const m = r.preview.months[0];
    expect(await closeHistoryMonthAction(g.client.id, { year: 2026, month: 5 }, m, NOTE, m.fingerprint, false)).toEqual({ ok: false, error: "Hanya admin kantor yang dapat menutup beberapa bulan sekaligus." });
    Object.assign(session, { memberId: admin.id, role: "ADMIN" });
    expect(await closeHistoryMonthAction(g.client.id, { year: 2026, month: 5 }, m, NOTE, m.fingerprint, true)).toEqual({ ok: true });
    expect(await status(g, 3)).toBe("LOCKED");
    Object.assign(session, { firmId: "another-firm" });
    expect((await historyPreviewAction(g.client.id, 2026, 5)).ok).toBe(false);
  });
});
