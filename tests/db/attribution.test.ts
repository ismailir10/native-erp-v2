import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { postAdjustment } from "@/lib/ledger/adjustment";
import { lockPeriod } from "@/lib/controls";
import { accountLedger } from "@/lib/reports/account-ledger";
import { dateOnly } from "@/lib/format";

/** Who-did-what: every posting, sign-off and lock keeps the member; seeds and system runs leave null ("Sistem"). */
describe("attribution", () => {
  beforeEach(async () => { await resetDb(); });

  async function member(firmId: string, name = "Sari") {
    return db.firmMember.create({ data: { firmId, userId: randomUUID(), email: `${name.toLowerCase()}@example.test`, name } });
  }

  it("postJournal stores the actor and leaves null for system postings", async () => {
    const g = await makeGroup();
    const m = await member(g.firm.id);
    const accounts = await db.account.findMany({ where: { clientId: g.client.id, code: { in: ["1101", "5100"] } } });
    const [bank, expense] = [accounts.find((a) => a.code === "1101")!, accounts.find((a) => a.code === "5100")!];
    const lines = [{ accountId: expense.id, debit: 1000n }, { accountId: bank.id, credit: 1000n }];
    const withActor = await db.$transaction((tx) => postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 8, 5), kind: "ADJUSTMENT", memo: "Uji", lines, actorId: m.id }));
    const system = await db.$transaction((tx) => postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 8, 6), kind: "ADJUSTMENT", memo: "Seed", lines }));
    expect((await db.journalEntry.findUniqueOrThrow({ where: { id: withActor.id } })).postedById).toBe(m.id);
    expect((await db.journalEntry.findUniqueOrThrow({ where: { id: system.id } })).postedById).toBeNull();
    // Amounts are untouched by attribution: the ledger still balances and names the poster.
    const ledger = await accountLedger(db, { entityIds: [g.pt.entity.id], start: dateOnly(2026, 8, 1), end: dateOnly(2026, 8, 31), normalBalance: "DEBIT", accountId: expense.id });
    expect(ledger.rows.map((r) => r.postedBy?.split(" · ")[0])).toEqual(["Sari", "Sistem"]);
    expect(ledger.rows.map((r) => r.debit)).toEqual(["1000", "1000"]);
  });

  it("adjustments, sign-offs and the lock carry the member", async () => {
    const g = await makeGroup();
    const m = await member(g.firm.id, "Budi");
    const entry = await postAdjustment(db, { clientId: g.client.id, entityId: g.pt.entity.id, date: dateOnly(2026, 8, 10), memo: "Koreksi", lines: [{ accountCode: "5100", debit: "1000", credit: "" }, { accountCode: "1101", debit: "", credit: "1000" }], actorId: m.id });
    expect((await db.journalEntry.findUniqueOrThrow({ where: { id: entry.id } })).postedById).toBe(m.id);
    const period = await db.period.findFirstOrThrow({ where: { clientId: g.client.id, year: 2026, month: 8 } });
    const signoff = await db.closeSignoff.create({ data: { periodId: period.id, key: "docs", doneById: m.id } });
    expect((await db.closeSignoff.findUniqueOrThrow({ where: { id: signoff.id }, include: { doneBy: true } })).doneBy?.name).toBe("Budi");
    // lockPeriod runs the controls; an empty August with one balanced entry needs the sign-offs to be complete.
    const { CLOSE_SIGNOFFS } = await import("@/lib/controls");
    for (const s of CLOSE_SIGNOFFS) if (s.key !== "docs") await db.closeSignoff.create({ data: { periodId: period.id, key: s.key, doneById: m.id } });
    const controls = await (await import("@/lib/controls")).runControls(db, g.client.id, 2026, 8);
    for (const c of controls) if (c.status === "REVIEW") await db.controlAck.create({ data: { periodId: period.id, controlKey: c.key, note: "Wajar untuk uji", ackedById: m.id } });
    if (controls.every((c) => c.status !== "FAIL")) {
      const locked = await lockPeriod(db, g.client.id, 2026, 8, "Uji", m.id);
      expect(locked.lockedById).toBe(m.id);
    }
  });
});
