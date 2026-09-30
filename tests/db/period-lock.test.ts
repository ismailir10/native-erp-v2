import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { CLOSE_SIGNOFFS, CloseError, lockPeriod, runControls, unlockPeriod } from "@/lib/controls";
import { deleteClient } from "@/lib/clients/delete";
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
const { ackControlAction, unlockAction } = await import("@/app/actions");

type G = Awaited<ReturnType<typeof makeGroup>>;
const member = (g: G, role: "ADMIN" | "AKUNTAN", name: string) => db.firmMember.create({ data: { firmId: g.firm.id, userId: randomUUID(), email: `${name}@example.test`, name, role } });

/** One balanced entry in the month (so it "has data"). */
async function entry(g: G, month: number, kind: "ADJUSTMENT" | "OPENING" = "ADJUSTMENT", day = 10) {
  const id = async (code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
  return db.$transaction(async (tx) =>
    postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, month, day), kind, memo: `Uji ${month}`, lines: [{ accountId: await id("1120"), debit: 1000n }, { accountId: await id("4100"), credit: 1000n }] }),
  );
}
/** Sign-offs ticked and every Perlu dicek control noted: what the accountant does before Tutup buku. */
async function ready(g: G, month: number) {
  const period = await db.period.upsert({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month } }, create: { firmId: g.firm.id, clientId: g.client.id, year: 2026, month }, update: {} });
  for (const s of CLOSE_SIGNOFFS) await db.closeSignoff.upsert({ where: { periodId_key: { periodId: period.id, key: s.key } }, create: { periodId: period.id, key: s.key }, update: {} });
  for (const c of await runControls(db, g.client.id, 2026, month)) {
    if (c.status === "REVIEW") await db.controlAck.upsert({ where: { periodId_controlKey: { periodId: period.id, controlKey: c.key } }, create: { periodId: period.id, controlKey: c.key, note: "Wajar untuk uji" }, update: {} });
  }
}
const lock = async (g: G, month: number) => {
  await ready(g, month);
  return lockPeriod(db, g.client.id, 2026, month, "uji");
};
const status = async (g: G, month: number) => (await db.period.findUniqueOrThrow({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month } } })).status;

describe("period lock order", () => {
  beforeEach(resetDb);

  it("refuses to lock a month while an earlier month with data is open, and names it", async () => {
    const g = await makeGroup();
    await entry(g, 7);
    await entry(g, 8);
    await ready(g, 8);
    await expect(lockPeriod(db, g.client.id, 2026, 8, "uji")).rejects.toThrow(new CloseError("Tutup buku Juli 2026 dulu: bulan sebelumnya yang berisi transaksi harus ditutup lebih dulu."));
    expect(await status(g, 8)).toBe("OPEN");
    expect((await lock(g, 7)).status).toBe("LOCKED");
    expect((await lock(g, 8)).status).toBe("LOCKED");
  });

  it("names the earliest open month, and skips empty months and a month that only holds the Saldo Awal", async () => {
    const g = await makeGroup();
    await entry(g, 1, "OPENING", 1);
    await entry(g, 5);
    await entry(g, 8);
    await expect(lockPeriod(db, g.client.id, 2026, 8, "uji")).rejects.toThrow(/Tutup buku Mei 2026 dulu/);
    await lock(g, 5);
    // Jan (Saldo Awal only) and the empty months in between never block; Aug needs May only.
    expect((await lock(g, 8)).status).toBe("LOCKED");
  });

  it("refuses to reopen a month while a later month is locked", async () => {
    const g = await makeGroup();
    const admin = await member(g, "ADMIN", "admin");
    await entry(g, 7);
    await entry(g, 8);
    await lock(g, 7);
    await lock(g, 8);
    await expect(unlockPeriod(db, g.client.id, 2026, 7, admin, "Koreksi faktur")).rejects.toThrow(new CloseError("Buka kembali Agustus 2026 dulu: bulan setelahnya masih ditutup."));
    expect(await status(g, 7)).toBe("LOCKED");
    expect(await db.periodUnlockLog.count()).toBe(0);
    await unlockPeriod(db, g.client.id, 2026, 8, admin, "Koreksi faktur");
    await unlockPeriod(db, g.client.id, 2026, 7, admin, "Koreksi faktur");
    expect([await status(g, 7), await status(g, 8)]).toEqual(["OPEN", "OPEN"]);
  });
});

describe("unlock: admin only, reasoned, logged", () => {
  beforeEach(resetDb);

  it("refuses an akuntan and leaves the month closed with no log", async () => {
    const g = await makeGroup();
    const akuntan = await member(g, "AKUNTAN", "sari");
    await entry(g, 8);
    await lock(g, 8);
    await expect(unlockPeriod(db, g.client.id, 2026, 8, akuntan, "Koreksi faktur")).rejects.toThrow(new CloseError("Hanya admin kantor yang dapat membuka kembali periode."));
    expect(await status(g, 8)).toBe("LOCKED");
    expect(await db.periodUnlockLog.count()).toBe(0);
  });

  it("needs a real reason", async () => {
    const g = await makeGroup();
    const admin = await member(g, "ADMIN", "admin");
    await entry(g, 8);
    await lock(g, 8);
    for (const reason of ["", "   ", "ok"]) {
      await expect(unlockPeriod(db, g.client.id, 2026, 8, admin, reason)).rejects.toThrow(new CloseError("Tulis alasan membuka kembali periode (min. 5 karakter)."));
    }
    expect(await status(g, 8)).toBe("LOCKED");
    expect(await db.periodUnlockLog.count()).toBe(0);
  });

  it("reopens for an admin and writes the audit row in the same step", async () => {
    const g = await makeGroup();
    const admin = await member(g, "ADMIN", "admin");
    await entry(g, 8);
    await lock(g, 8);
    await unlockPeriod(db, g.client.id, 2026, 8, admin, "  Faktur pajak terlambat masuk  ");
    const p = await db.period.findUniqueOrThrow({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month: 8 } } });
    expect([p.status, p.lockedAt, p.lockedById]).toEqual(["OPEN", null, null]);
    const logs = await db.periodUnlockLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ firmId: g.firm.id, clientId: g.client.id, year: 2026, month: 8, unlockedById: admin.id, reason: "Faktur pajak terlambat masuk" });
    // Reopened months can be closed again; the log stays.
    await lock(g, 8);
    await unlockPeriod(db, g.client.id, 2026, 8, admin, "Salah tutup");
    expect(await db.periodUnlockLog.count()).toBe(2);
  });

  it("refuses a month that is not closed", async () => {
    const g = await makeGroup();
    const admin = await member(g, "ADMIN", "admin");
    await entry(g, 8);
    await expect(unlockPeriod(db, g.client.id, 2026, 8, admin, "Koreksi faktur")).rejects.toThrow(new CloseError("Periode Agustus 2026 belum ditutup."));
    expect(await db.periodUnlockLog.count()).toBe(0);
  });

  it("goes through the server action with the session's role", async () => {
    const g = await makeGroup();
    const admin = await member(g, "ADMIN", "admin");
    const akuntan = await member(g, "AKUNTAN", "sari");
    await entry(g, 8);
    await lock(g, 8);
    session.firmId = g.firm.id;
    Object.assign(session, { role: "AKUNTAN", memberId: akuntan.id });
    expect(await unlockAction(g.client.id, 2026, 8, "Koreksi faktur")).toEqual({ ok: false, error: "Hanya admin kantor yang dapat membuka kembali periode." });
    Object.assign(session, { role: "ADMIN", memberId: admin.id });
    expect(await unlockAction(g.client.id, 2026, 8, "")).toEqual({ ok: false, error: "Tulis alasan membuka kembali periode (min. 5 karakter)." });
    expect(await unlockAction(g.client.id, 2026, 8, "Koreksi faktur")).toEqual({ ok: true });
    expect(await status(g, 8)).toBe("OPEN");
    expect((await db.periodUnlockLog.findMany()).map((l) => [l.unlockedById, l.reason])).toEqual([[admin.id, "Koreksi faktur"]]);
  });

  it("deleting a client removes its unlock log", async () => {
    const g = await makeGroup();
    const admin = await member(g, "ADMIN", "admin");
    await entry(g, 8);
    await lock(g, 8);
    await unlockPeriod(db, g.client.id, 2026, 8, admin, "Koreksi faktur");
    await deleteClient(db, { firmId: g.firm.id, clientId: g.client.id, confirmName: "Grup Uji" });
    expect(await db.periodUnlockLog.count()).toBe(0);
    expect(await db.firmMember.count()).toBe(1);
  });
});

describe("close notes answer the control as it read", () => {
  beforeEach(resetDb);
  const periodOf = (g: G, month: number) => db.period.upsert({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month } }, create: { firmId: g.firm.id, clientId: g.client.id, year: 2026, month }, update: {} });

  it("a note clears the control only while its detail is unchanged; older notes without a detail keep working", async () => {
    const g = await makeGroup();
    await entry(g, 8);
    const review = (await runControls(db, g.client.id, 2026, 8)).filter((c) => c.status === "REVIEW");
    expect(review.length).toBeGreaterThanOrEqual(3);
    const [same, changed, legacy] = review;
    const period = await periodOf(g, 8);
    await db.controlAck.createMany({ data: [
      { periodId: period.id, controlKey: same.key, note: "Sudah dicek", detail: same.detail },
      { periodId: period.id, controlKey: changed.key, note: "Dua transaksi, wajar", detail: "2 transaksi menunggu review" },
      { periodId: period.id, controlKey: legacy.key, note: "Catatan lama" },
    ] });
    const now = new Map((await runControls(db, g.client.id, 2026, 8)).map((c) => [c.key, c]));
    expect([now.get(same.key)!.ack, now.get(same.key)!.staleAck]).toEqual(["Sudah dicek", undefined]);
    expect([now.get(changed.key)!.ack, now.get(changed.key)!.staleAck]).toEqual([undefined, "Dua transaksi, wajar"]);
    expect(now.get(legacy.key)!.ack).toBe("Catatan lama");
  });

  it("the note action stores the detail it answered", async () => {
    const g = await makeGroup();
    const admin = await member(g, "ADMIN", "admin");
    await entry(g, 8);
    Object.assign(session, { firmId: g.firm.id, role: "ADMIN", memberId: admin.id });
    const c = (await runControls(db, g.client.id, 2026, 8)).find((x) => x.status === "REVIEW")!;
    expect(await ackControlAction(g.client.id, 2026, 8, c.key, "Wajar, dicek")).toEqual({ ok: true });
    expect(await db.controlAck.findFirstOrThrow({ where: { controlKey: c.key } })).toMatchObject({ note: "Wajar, dicek", detail: c.detail, ackedById: admin.id });
  });

  it("reopening a month removes its sign-offs, so closing again needs them given again", async () => {
    const g = await makeGroup();
    const admin = await member(g, "ADMIN", "admin");
    await entry(g, 8);
    await lock(g, 8);
    await unlockPeriod(db, g.client.id, 2026, 8, admin, "Faktur susulan");
    expect(await db.closeSignoff.count({ where: { period: { clientId: g.client.id, month: 8 } } })).toBe(0);
    await expect(lockPeriod(db, g.client.id, 2026, 8, "uji")).rejects.toThrow(/3 checklist belum dicentang/);
  });
});
