import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { importStatement } from "@/lib/import/pipeline";
import { reviewTransaction } from "@/lib/review";
import { formatMoney } from "@/lib/money";
import { createLease, leasesVsLedger, postLeaseMonths } from "@/lib/leases/register";
import { runControls } from "@/lib/controls";

type G = Awaited<ReturnType<typeof makeGroup>>;

/** PT Uji's BCA Giro (invented): rent of 50 jt paid as 45 jt to the landlord, then 5 jt PPh 4(2) to DJP. */
const CSV = [
  "Tanggal;Keterangan;Debet;Kredit;Saldo",
  "05/08/2026;TRSF E-BANKING DB PT GRAHA LOGISTIK SEWA GUDANG;45000000;0;55000000",
  "10/09/2026;SETORAN PPH 4(2) SEWA GUDANG DJP;5000000;0;50000000",
  "",
].join("\n");

const gl = async (g: G, code: string) => {
  const a = await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } });
  const s = await db.journalLine.aggregate({ where: { accountId: a.id }, _sum: { debit: true, credit: true } });
  return (s._sum.debit ?? 0n) - (s._sum.credit ?? 0n);
};

describe("withholding on a bank line", () => {
  beforeEach(resetDb);

  it("rent with PPh 4(2): Dr rent 50 jt / Cr bank 45 jt / Cr 2145 5 jt, then the remittance clears 2145", async () => {
    const g = await makeGroup();
    await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca.csv", data: Buffer.from(CSV), provider: null });
    const rent = await db.bankTransaction.findFirstOrThrow({ where: { description: { contains: "PT GRAHA LOGISTIK" } } });
    const remit = await db.bankTransaction.findFirstOrThrow({ where: { description: { contains: "PPH 4(2)" } } });
    expect(remit).toMatchObject({ accountCode: "2145", taxTag: "PPH_4_2", status: "POSTED" }); // the firm rule
    expect(await gl(g, "2145")).toBe(5_000_000n); // remitted before it was withheld: a debit the accountant is asked about

    await reviewTransaction(db, { bankTxId: rent.id, accountCode: "6120", taxTag: null, withholding: { kind: "PPH_4_2", amount: 5_000_000n } });
    expect(await db.bankTransaction.findUniqueOrThrow({ where: { id: rent.id } })).toMatchObject({ whtKind: "PPH_4_2", whtAmount: 5_000_000n });
    expect(await gl(g, "6120")).toBe(50_000_000n);
    expect(await gl(g, "1101")).toBe(-50_000_000n); // 45 jt + 5 jt out of the bank in all
    expect(await gl(g, "2145")).toBe(0n);
    expect(await gl(g, "1999")).toBe(0n);
    // every line of the rent's entries keeps its bank row
    const entries = await db.journalEntry.findMany({ where: { bankTransactionId: rent.id }, include: { lines: { include: { account: true } } } });
    expect(entries.flatMap((e) => e.lines.map((l) => [l.account.code, l.debit - l.credit])).filter(([c]) => c !== "1999")).toEqual(
      expect.arrayContaining([["6120", 50_000_000n], ["2145", -5_000_000n], ["1101", -45_000_000n]]),
    );
  });

  it("reclasses only the difference when the withholding changes or goes, and keeps it through a change of account", async () => {
    const g = await makeGroup();
    await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca.csv", data: Buffer.from(CSV), provider: null });
    const rent = await db.bankTransaction.findFirstOrThrow({ where: { description: { contains: "PT GRAHA LOGISTIK" } } });
    await reviewTransaction(db, { bankTxId: rent.id, accountCode: "6120", taxTag: null, withholding: { kind: "PPH_4_2", amount: 5_000_000n } });
    await reviewTransaction(db, { bankTxId: rent.id, accountCode: "1170", taxTag: null }); // prepaid rent instead: the tax leg stays
    expect(await gl(g, "1170")).toBe(50_000_000n);
    expect(await gl(g, "6120")).toBe(0n);
    expect(await gl(g, "2145")).toBe(0n); // withheld 5 jt, remitted 5 jt
    await reviewTransaction(db, { bankTxId: rent.id, accountCode: "1170", taxTag: null, withholding: null });
    expect(await gl(g, "1170")).toBe(45_000_000n);
    expect(await db.bankTransaction.findUniqueOrThrow({ where: { id: rent.id } })).toMatchObject({ whtKind: null, whtAmount: 0n });
    await expect(reviewTransaction(db, { bankTxId: rent.id, accountCode: "1170", taxTag: null, withholding: { kind: "PPH_4_2", amount: 0n } })).rejects.toThrow(/lebih dari nol/);
  });

  it("books a customer's PPh 23 on a receipt to 1180 and a final PPh 4(2) to 8200, and refuses PPh 21 on money in", async () => {
    const g = await makeGroup();
    const csv = ["Tanggal;Keterangan;Debet;Kredit;Saldo", "20/08/2026;TRSF E-BANKING CR PT MITRA JASA;0;10900000;110900000", "21/08/2026;TRSF E-BANKING CR CV SEWA MASUK;0;9000000;119900000", ""].join("\n");
    await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca.csv", data: Buffer.from(csv), provider: null });
    const a = await db.bankTransaction.findFirstOrThrow({ where: { description: { contains: "MITRA JASA" } } });
    const b = await db.bankTransaction.findFirstOrThrow({ where: { description: { contains: "SEWA MASUK" } } });
    await reviewTransaction(db, { bankTxId: a.id, accountCode: "1130", taxTag: null, withholding: { kind: "PPH_23", amount: 200_000n } });
    expect(await gl(g, "1180")).toBe(200_000n);
    expect(await gl(g, "1130")).toBe(-11_100_000n);
    await reviewTransaction(db, { bankTxId: b.id, accountCode: "4900", taxTag: null, withholding: { kind: "PPH_4_2", amount: 1_000_000n } });
    expect(await gl(g, "8200")).toBe(1_000_000n);
    expect(await gl(g, "4900")).toBe(-10_000_000n);
    await expect(reviewTransaction(db, { bankTxId: b.id, accountCode: "4900", taxTag: null, withholding: { kind: "PPH_21", amount: 1n } })).rejects.toThrow(/hanya bisa dipotong/);
    expect(formatMoney(await gl(g, "1180"), "IDR")).toContain("200.000");
  });

  it("lease rent paid net of PPh 4(2) still ties the lease liability to the register (lease control passes)", async () => {
    const g = await makeGroup();
    await createLease(db, { clientId: g.client.id, entityId: g.pt.entity.id, name: "Kantor Sudirman", lessor: "PT Graha Properti", start: "2026-06", months: 24, payment: "10.000.000", intervalMonths: 1, timing: "ARREARS", rate: "12" });
    await postLeaseMonths(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month: 8 });
    // 10 jt of rent a month: 9 jt to the lessor, 1 jt (10 %) to DJP
    const csv = ["Tanggal;Keterangan;Debet;Kredit;Saldo", ...[["30/06", 91], ["31/07", 82], ["31/08", 73]].map(([d, bal]) => `${d}/2026;TRSF DB PT GRAHA PROPERTI SEWA;9000000;0;${bal}000000`), ""].join("\n");
    await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca.csv", data: Buffer.from(csv), provider: null });
    for (const t of await db.bankTransaction.findMany({ where: { description: { contains: "GRAHA" } } })) {
      await reviewTransaction(db, { bankTxId: t.id, accountCode: "2170", taxTag: null, withholding: { kind: "PPH_4_2", amount: 1_000_000n } });
    }
    expect(await leasesVsLedger(db, g.client.id, g.pt.entity.id, 2026, 8)).toMatchObject({ equal: true, due: 0 });
    expect((await runControls(db, g.client.id, 2026, 8)).find((c) => c.key === `lease:${g.pt.entity.id}`)).toMatchObject({ status: "PASS" });
    expect(await gl(g, "2145")).toBe(-3_000_000n); // three months withheld, not yet remitted
  });
});
