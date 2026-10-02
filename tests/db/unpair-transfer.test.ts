import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { importStatement } from "@/lib/import/pipeline";
import { unpairTransfer } from "@/lib/review";
import { trialBalance } from "@/lib/reports/ledger";
import { dateOnly } from "@/lib/format";

/** UC-B2: *Lepas pasangan* sends both halves back to Review and no later import pairs them again. */
const file = (opening: string, ...rows: string[]) => Buffer.from(["Tanggal;Keterangan;Debet;Kredit;Saldo", `01/08/2026;SALDO AWAL;;;${opening}`, ...rows, ""].join("\n"));

describe("lepas pasangan transfer", () => {
  beforeEach(resetDb);

  async function paired() {
    const g = await makeGroup();
    const [bca, mdr] = g.pt.banks;
    await importStatement(db, { bankAccountId: bca.id, fileName: "bca.csv", data: file("100.000.000,00", "05/08/2026;PINDAH BUKU KE MANDIRI PT UJI SEJAHTERA;5.000.000,00;0,00;95.000.000,00"), provider: null });
    await importStatement(db, { bankAccountId: mdr.id, fileName: "mdr.csv", data: file("10.000.000,00", "05/08/2026;PINDAH BUKU DARI BCA PT UJI SEJAHTERA;0,00;5.000.000,00;15.000.000,00"), provider: null });
    const [out, inn] = await Promise.all([db.bankTransaction.findFirstOrThrow({ where: { bankAccountId: bca.id } }), db.bankTransaction.findFirstOrThrow({ where: { bankAccountId: mdr.id } })]);
    return { g, bca, mdr, out, inn };
  }
  const net = async (clientId: string, entityId: string, code: string) => (await trialBalance(db, { clientId, entityIds: [entityId] }, dateOnly(2026, 8, 31))).find((r) => r.account.code === code)?.net ?? 0n;

  it("sends both halves to Review on 1999 with their suggestion kept, and a later import never pairs them again", async () => {
    const { g, mdr, out, inn } = await paired();
    expect([out.matchedTxId, inn.matchedTxId, out.accountCode]).toEqual([inn.id, out.id, "1199"]);

    await unpairTransfer(db, { clientId: g.client.id, bankTxId: inn.id });
    const both = await db.bankTransaction.findMany({ where: { id: { in: [out.id, inn.id] } } });
    for (const t of both) expect(t).toMatchObject({ status: "NEEDS_REVIEW", accountCode: "1999", suggestedCode: "1199", matchedTxId: null, pairRefused: true });
    expect(await net(g.client.id, g.pt.entity.id, "1199")).toBe(0n);
    expect(await db.journalEntry.count({ where: { bankTransactionId: { in: [out.id, inn.id] }, kind: "RECLASS" } })).toBe(2);

    // A new credit of the same amount the next day would have been a candidate for the refused out-line: it stays unpaired.
    await importStatement(db, { bankAccountId: mdr.id, fileName: "mdr-2.csv", data: file("10.000.000,00", "05/08/2026;PINDAH BUKU DARI BCA PT UJI SEJAHTERA;0,00;5.000.000,00;15.000.000,00", "06/08/2026;PINDAH BUKU DARI BCA PT UJI SEJAHTERA;0,00;5.000.000,00;20.000.000,00"), provider: null });
    const fresh = await db.bankTransaction.findFirstOrThrow({ where: { bankAccountId: mdr.id, date: dateOnly(2026, 8, 6) } });
    expect(fresh.matchedTxId).toBeNull();
    expect((await db.bankTransaction.findUniqueOrThrow({ where: { id: out.id } })).matchedTxId).toBeNull();
  });

  it("refuses a line that isn't paired, and a closed month", async () => {
    const { g, out, inn } = await paired();
    await db.period.update({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month: 8 } }, data: { status: "LOCKED" } });
    await expect(unpairTransfer(db, { clientId: g.client.id, bankTxId: out.id })).rejects.toThrow(/sudah ditutup/);
    expect((await db.bankTransaction.findUniqueOrThrow({ where: { id: inn.id } })).matchedTxId).toBe(out.id);
    await db.period.update({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month: 8 } }, data: { status: "OPEN" } });
    await unpairTransfer(db, { clientId: g.client.id, bankTxId: out.id });
    await expect(unpairTransfer(db, { clientId: g.client.id, bankTxId: out.id })).rejects.toThrow("Mutasi ini tidak berpasangan dengan transfer lain.");
  });
});
