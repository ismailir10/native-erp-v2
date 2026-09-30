import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { dateOnly } from "@/lib/format";
import { reasonText, reportStatus } from "@/lib/reports/status";
import { CLOSE_SIGNOFFS, lockPeriod, runControls } from "@/lib/controls";
import { recordInventoryCount } from "@/lib/inventory";

type G = Awaited<ReturnType<typeof makeGroup>>;
const acc = async (g: G, code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
const post = async (g: G, date: Date, kind: "OPENING" | "ADJUSTMENT", dr: string, cr: string, amount: bigint) =>
  db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date, kind, memo: "uji", lines: [{ accountId: await acc(g, dr), debit: amount }, { accountId: await acc(g, cr), credit: amount }] }));

describe("report status: final or draft, and why", () => {
  beforeEach(resetDb);

  it("names what keeps an open month a draft, and says final once it is closed", async () => {
    const g = await makeGroup();
    const pt = [g.pt.entity.id];
    await post(g, dateOnly(2026, 6, 30), "OPENING", "1160", "3100", 50_000n);
    await post(g, dateOnly(2026, 7, 5), "ADJUSTMENT", "1999", "4100", 7_000n);
    const draft = await reportStatus(db, g.client.id, pt, 2026, 7);
    expect(draft.locked).toBeNull();
    // Two PT bank accounts without a July statement, money on 1999, the stock not counted.
    expect(draft.reasons.map((r) => reasonText(r, (v) => v.toString()))).toEqual([
      "Belum Terklasifikasi (1999) 7000",
      "rekening koran belum lengkap: BCA Giro, Mandiri Giro",
      "persediaan akhir belum dicatat: PT Uji",
    ]);

    await post(g, dateOnly(2026, 7, 6), "ADJUSTMENT", "4100", "1999", 7_000n);
    await recordInventoryCount(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month: 7, amount: 50_000n });
    expect((await reportStatus(db, g.client.id, pt, 2026, 7)).reasons.map((r) => r.kind)).toEqual(["statements"]);

    const period = await db.period.findUniqueOrThrow({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month: 7 } } });
    await db.closeSignoff.createMany({ data: CLOSE_SIGNOFFS.map((s) => ({ periodId: period.id, key: s.key })) });
    for (const c of (await runControls(db, g.client.id, 2026, 7)).filter((c) => c.status === "REVIEW")) await db.controlAck.create({ data: { periodId: period.id, controlKey: c.key, note: "Rekening mulai Agustus", detail: c.detail } });
    await lockPeriod(db, g.client.id, 2026, 7, "uji");
    expect((await reportStatus(db, g.client.id, pt, 2026, 7)).locked).toMatchObject({ at: expect.any(Date) });
  });
});
