import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { compareSubledger, deleteSubledgerImport, importAging, resolveSubledgerFinding } from "@/lib/reconcile/subledger";
import { runControls } from "@/lib/controls";
import { reportStatus } from "@/lib/reports/status";
import { dateOnly } from "@/lib/format";

const J = 1_000_000n;
const csv = (...rows: string[]) => Buffer.from(["Laporan Umur Piutang", "Nama Pelanggan;Belum Jatuh Tempo;Total", ...rows, ""].join("\n"));

/** UC-A1: a client's aging against the ledger, with planted differences (cut-off, advance, non-trade) and a Rp 5 rounding. */
async function books() {
  const g = await makeGroup();
  const acc = async (code: string) => (await db.account.findUniqueOrThrow({ where: { clientId_code: { clientId: g.client.id, code } } })).id;
  await db.$transaction(async (tx) => {
    const post = async (date: Date, lines: [string, bigint, bigint][]) =>
      postJournal(tx, { entityId: g.pt.entity.id, date, kind: "ADJUSTMENT", memo: "uji", lines: await Promise.all(lines.map(async ([c, d, k]) => ({ accountId: await acc(c), debit: d, credit: k }))) });
    await post(dateOnly(2023, 12, 1), [["1130", 10n * J, 0n], ["4100", 0n, 10n * J]]);
    await post(dateOnly(2023, 12, 15), [["1130", 5n * J, 0n], ["4100", 0n, 5n * J]]);
    await post(dateOnly(2023, 12, 30), [["1130", 2n * J, 0n], ["4100", 0n, 2n * J]]); // cut-off: in the books, not in the aging
    await post(dateOnly(2023, 12, 20), [["1110", 500_000n, 0n], ["2160", 0n, 500_000n]]); // a customer's advance
    await post(dateOnly(2023, 12, 10), [["6190", 8n * J, 0n], ["2110", 0n, 8n * J]]);
    await post(dateOnly(2023, 12, 11), [["1110", 3n * J, 0n], ["2120", 0n, 3n * J]]); // non-trade: a shareholder loan
  });
  const base = { clientId: g.client.id, entityId: g.pt.entity.id, asOf: "2023-12-31" };
  return { g, base };
}

describe("rekonsiliasi subledger", () => {
  beforeEach(resetDb);

  it("shows the difference with its percent and candidate causes, opens one Temuan, updates it on re-import and closes it when the aging matches", async () => {
    const { g, base } = await books();
    const first = await importAging(db, { ...base, kind: "RECEIVABLE", fileName: "aging-2023.csv", data: csv("PT Sinar Jaya;10.000.000;10.000.000", "CV Maju;5.000.000;5.000.000", "Toko Lancar;(500.000);(500.000)") });
    expect([first.status, first.difference, first.rows]).toEqual(["DIFFERENCE", -2_500_000n, 3]);
    const c = await compareSubledger(db, g.client.id, first.importId);
    expect([c.aging, c.ledger, c.percent, c.accounts.map((a) => [a.code, a.balance])]).toEqual([14_500_000n, 17n * J, -14.7, [["1130", 17n * J]]]);
    expect(c.candidates.cutoff.map((x) => [x.date.toISOString().slice(0, 10), x.amount])).toEqual([["2023-12-30", 2n * J]]);
    expect(c.candidates.credits).toEqual([{ counterparty: "Toko Lancar", total: -500_000n, sourceRef: "CSV!5" }]);
    expect(c.candidates.advances.map((a) => [a.code, a.balance])).toEqual([["2160", 500_000n]]);
    expect(c.finding).toMatchObject({ status: "OPEN", label: "T-001" });
    const f1 = await db.finding.findFirstOrThrow({ where: { kind: "SUBLEDGER_DIFFERENCE" } });
    expect(f1.question).toContain("Aging piutang PT Uji per 31 Des 2023 (aging-2023.csv) Rp 14.500.000 vs buku besar Rp 17.000.000 (1130): selisih -Rp 2.500.000 (-14,7%)");

    // The same date again (the missing invoice added): the Temuan is updated, not duplicated.
    const second = await importAging(db, { ...base, kind: "RECEIVABLE", fileName: "aging-2023-v2.csv", data: csv("PT Sinar Jaya;10.000.000;10.000.000", "CV Maju;5.000.000;5.000.000", "Toko Lancar;(500.000);(500.000)", "PT Akhir Tahun;2.000.000;2.000.000") });
    expect([second.status, second.difference]).toEqual(["DIFFERENCE", -500_000n]);
    expect((await db.finding.findMany({ where: { kind: "SUBLEDGER_DIFFERENCE" } })).map((f) => [f.id, f.amount, f.status])).toEqual([[f1.id, -500_000n, "OPEN"]]);
    expect(await db.subledgerImport.count()).toBe(1);

    // The advance moved out of the aging: it matches, and the Temuan closes saying why.
    const third = await importAging(db, { ...base, kind: "RECEIVABLE", fileName: "aging-2023-v3.csv", data: csv("PT Sinar Jaya;10.000.000;10.000.000", "CV Maju;5.000.000;5.000.000", "PT Akhir Tahun;2.000.000;2.000.000") });
    expect(third.status).toBe("MATCH");
    const closed = await db.finding.findUniqueOrThrow({ where: { id: f1.id } });
    expect([closed.status, closed.resolution]).toEqual(["RESOLVED", "Aging baru per 31 Des 2023 (aging-2023-v3.csv) cocok dengan buku besar."]);
  });

  it("keeps a Rp 5 rounding apart, and names the non-trade payables the aging leaves out", async () => {
    const { g, base } = await books();
    const r = await importAging(db, { ...base, kind: "PAYABLE", fileName: "aging-ap.csv", data: Buffer.from("Supplier;Saldo\nPT Pemasok;8.000.005\n") });
    expect([r.status, r.difference]).toEqual(["ROUNDING", 5n]);
    expect(await db.finding.count()).toBe(0);
    const c = await compareSubledger(db, g.client.id, r.importId);
    expect(c.candidates.nonTrade.map((a) => [a.code, a.balance])).toEqual([["2120", 3n * J]]);
    expect(c.candidates.advances.map((a) => a.code)).not.toContain("2160");
  });

  it("closes a Temuan with an explanation (posting nothing), shows it on the close until then, and a removed import closes its Temuan", async () => {
    const { g, base } = await books();
    const r = await importAging(db, { ...base, kind: "RECEIVABLE", fileName: "aging.csv", data: csv("PT Sinar Jaya;10.000.000;10.000.000") });
    const f = await db.finding.findFirstOrThrow({ where: { kind: "SUBLEDGER_DIFFERENCE" } });
    // Not an opening difference: the report's draft reasons don't call it one.
    expect((await reportStatus(db, g.client.id, [g.pt.entity.id], 2023, 12)).reasons.map((x) => x.kind)).not.toContain("findings");
    const controls = await runControls(db, g.client.id, 2023, 12);
    expect(controls.find((x) => x.key === `subledger:${g.pt.entity.id}`)).toMatchObject({ status: "REVIEW", title: "Rekonsiliasi subledger" });
    await expect(resolveSubledgerFinding(db, { clientId: g.client.id, findingId: f.id, explanation: "cut-off" })).rejects.toThrow("Tulis penjelasannya");
    const entries = await db.journalEntry.count();
    await resolveSubledgerFinding(db, { clientId: g.client.id, findingId: f.id, explanation: "Faktur CV Maju dan Desember akhir belum masuk aging sistem operasional; dikonfirmasi Bu Rina." });
    expect([(await db.finding.findUniqueOrThrow({ where: { id: f.id } })).status, await db.journalEntry.count()]).toEqual(["RESOLVED", entries]);
    expect((await runControls(db, g.client.id, 2023, 12)).some((x) => x.key.startsWith("subledger:"))).toBe(false);

    const again = await importAging(db, { ...base, asOf: "2024-12-31", kind: "RECEIVABLE", fileName: "aging-2024.csv", data: csv("PT Sinar Jaya;1;1") });
    const open = await db.finding.findFirstOrThrow({ where: { kind: "SUBLEDGER_DIFFERENCE", status: "OPEN" } });
    await deleteSubledgerImport(db, { clientId: g.client.id, importId: again.importId });
    expect((await db.finding.findUniqueOrThrow({ where: { id: open.id } })).resolution).toBe("Impor aging aging-2024.csv dihapus.");
    expect(await db.subledgerImport.findMany({ select: { id: true } })).toEqual([{ id: r.importId }]);
  });
});
