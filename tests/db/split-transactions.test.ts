import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { importStatement } from "@/lib/import/pipeline";
import { reviewTransaction, splitTransaction } from "@/lib/review";
import { createInvoice } from "@/lib/receivables/invoices";
import { settle, settleWithReclass } from "@/lib/receivables/settle";
import { byPart } from "@/lib/controls/sanity";
import { postBankTransaction } from "@/lib/ledger/bank";
import { balanceSheet } from "@/lib/reports/ledger";
import { listEvents } from "@/lib/audit";
import { dateOnly } from "@/lib/format";

/** UC-B3: a combined transfer ("gaji + ongkos produksi") split across accounts — balanced, posted by part, drillable to its bank row. */
const file = (opening: string, ...rows: string[]) => Buffer.from(["Tanggal;Keterangan;Debet;Kredit;Saldo", `01/08/2026;SALDO AWAL;;;${opening}`, ...rows, ""].join("\n"));
const J = 1_000_000n;

async function books() {
  const g = await makeGroup();
  const [bca, mdr] = g.pt.banks;
  await importStatement(db, {
    bankAccountId: bca.id,
    fileName: "bca.csv",
    data: file("500.000.000,00", "05/08/2026;TRSF E-BANKING DB BUDI SANTOSO GAJI DAN ONGKOS PRODUKSI;200.000.000,00;0,00;300.000.000,00", "06/08/2026;PINDAH BUKU KE MANDIRI PT UJI SEJAHTERA;1.000.000,00;0,00;299.000.000,00"),
    provider: null,
  });
  await importStatement(db, { bankAccountId: mdr.id, fileName: "mdr.csv", data: file("0,00", "06/08/2026;PINDAH BUKU DARI BCA PT UJI SEJAHTERA;0,00;1.000.000,00;1.000.000,00"), provider: null });
  const t = await db.bankTransaction.findFirstOrThrow({ where: { description: { contains: "BUDI SANTOSO" } } });
  const paired = await db.bankTransaction.findFirstOrThrow({ where: { bankAccountId: bca.id, description: { contains: "PINDAH" } } });
  return { g, t, paired };
}
/** The line's classification side by account (everything its entries posted, except the bank account). */
async function byAccount(bankTxId: string, bankAccountCode: string) {
  const lines = await db.journalLine.findMany({ where: { entry: { bankTransactionId: bankTxId } }, include: { account: true } });
  const out: Record<string, bigint> = {};
  for (const l of lines) if (l.account.code !== bankAccountCode) out[l.account.code] = (out[l.account.code] ?? 0n) + l.debit - l.credit;
  for (const k of Object.keys(out)) if (out[k] === 0n) delete out[k];
  return out;
}

describe("pecah transaksi", () => {
  beforeEach(resetDb);

  it("splits 200 jt into 120 jt gaji + 80 jt produksi, re-splits by the difference, and goes back to one account", async () => {
    const { g, t } = await books();
    const bankCode = (await db.account.findUniqueOrThrow({ where: { id: g.pt.banks[0].accountId } })).code;
    await splitTransaction(db, { bankTxId: t.id, parts: [{ accountCode: "6100", amount: "120.000.000" }, { accountCode: "5110", amount: "80.000.000", memo: "ongkos produksi Agustus" }] });
    expect(await byAccount(t.id, bankCode)).toEqual({ "6100": 120n * J, "5110": 80n * J });
    const line = await db.bankTransaction.findUniqueOrThrow({ where: { id: t.id }, include: { splits: { orderBy: { position: "asc" } } } });
    expect([line.status, line.accountCode, line.method, line.reason]).toEqual(["REVIEWED", "6100", "MANUAL", "Dipecah ke 2 akun"]);
    expect(line.splits.map((p) => [p.accountCode, p.amount, p.memo])).toEqual([["6100", 120n * J, null], ["5110", 80n * J, "ongkos produksi Agustus"]]);
    const bs = await balanceSheet(db, { clientId: g.client.id, entityIds: [g.pt.entity.id] }, dateOnly(2026, 8, 31));
    expect(bs.totals.assets).toBe(bs.totals.liabilities + bs.totals.equity);
    // Never learned: a combined transfer is a one-off.
    expect(await db.memory.count({ where: { merchantKey: t.merchantKey } })).toBe(0);
    expect((await listEvents(db, g.client.id, { subject: `bankTx:${t.id}` }))[0].summary).toBe(
      "TRSF E-BANKING DB BUDI SANTOSO GAJI DAN ONGKOS PRODUKSI · Rp 200.000.000: 6100 → dipecah 6100 Rp 120.000.000 + 5110 Rp 80.000.000",
    );

    // A re-split posts only the difference: 20 jt from gaji to produksi.
    await splitTransaction(db, { bankTxId: t.id, parts: [{ accountCode: "6100", amount: "100000000" }, { accountCode: "5110", amount: "100000000" }] });
    const last = await db.journalEntry.findFirstOrThrow({ where: { bankTransactionId: t.id }, orderBy: { createdAt: "desc" }, include: { lines: { include: { account: true } } } });
    expect([last.kind, last.lines.map((l) => [l.account.code, l.debit - l.credit]).sort()]).toEqual(["RECLASS", [["5110", 20n * J], ["6100", -20n * J]]]);

    // Another path re-posting it with one account is refused while the split stands…
    await expect(db.$transaction((tx) => postBankTransaction(tx, t.id, { accountCode: "6101" }))).rejects.toThrow("Mutasi ini dipecah ke beberapa akun.");
    // …and so is a decision that didn't ask to merge (settling, proposals, similar lines all go through it).
    await expect(reviewTransaction(db, { bankTxId: t.id, accountCode: "6100", taxTag: null })).rejects.toThrow("Mutasi ini dipecah ke beberapa akun.");
    // Buku Besar's "Gabungkan ke akun ini" replaces the split, even onto the account first suggested, and says so.
    await reviewTransaction(db, { bankTxId: t.id, accountCode: "6100", taxTag: null, replaceSplit: true });
    expect(await byAccount(t.id, bankCode)).toEqual({ "6100": 200n * J });
    expect(await db.bankTxSplit.count({ where: { bankTransactionId: t.id } })).toBe(0);
    const merged = await db.bankTransaction.findUniqueOrThrow({ where: { id: t.id } });
    expect([merged.method, merged.reason]).toEqual(["MANUAL", "Pecahan digabung ke 6100"]);
    expect((await listEvents(db, g.client.id, { subject: `bankTx:${t.id}` }))[0].summary).toContain(": dipecah 6100 → 6100");
  });

  it("refuses an unbalanced, single, duplicate, unclassified or paired split, and a closed month, naming what to do", async () => {
    const { g, t, paired } = await books();
    const split = (parts: { accountCode: string; amount: string }[], id = t.id) => splitTransaction(db, { bankTxId: id, parts });
    await expect(split([{ accountCode: "6100", amount: "120.000.000" }, { accountCode: "5110", amount: "70.000.000" }])).rejects.toThrow(
      "Jumlah bagian Rp 190.000.000 belum sama dengan nominal mutasi Rp 200.000.000 (kurang Rp 10.000.000).",
    );
    await expect(split([{ accountCode: "6100", amount: "130.000.000" }, { accountCode: "5110", amount: "80.000.000" }])).rejects.toThrow("(lebih Rp 10.000.000)");
    await expect(split([{ accountCode: "6100", amount: "200.000.000" }])).rejects.toThrow("Pecah ke setidaknya dua akun.");
    await expect(split([{ accountCode: "6100", amount: "100.000.000" }, { accountCode: "6100", amount: "100.000.000" }])).rejects.toThrow("dipakai di dua bagian");
    await expect(split([{ accountCode: "6100", amount: "200.000.000" }, { accountCode: "1999", amount: "0" }])).rejects.toThrow("Bagian 2: akun 1999");
    await expect(split([{ accountCode: "6100", amount: "200.000.000" }, { accountCode: "5110", amount: "0" }])).rejects.toThrow("Bagian 2: isi nominal lebih dari nol.");
    await expect(split([{ accountCode: "6100", amount: "500.000" }, { accountCode: "1199", amount: "500.000" }], paired.id)).rejects.toThrow("Lepas pasangannya dulu");
    // A posted PPN line can't be split (tax per part isn't supported); a suggestion in Review doesn't block.
    await reviewTransaction(db, { bankTxId: t.id, accountCode: "6100", taxTag: "PPN_MASUKAN" });
    await expect(split([{ accountCode: "6100", amount: "120.000.000" }, { accountCode: "5110", amount: "80.000.000" }])).rejects.toThrow("Mutasi ini memakai pajak (PPN/PPh).");
    await reviewTransaction(db, { bankTxId: t.id, accountCode: "6100", taxTag: null });
    // The transfer accounts are refused on an unpaired line too.
    await expect(split([{ accountCode: "6100", amount: "100.000.000" }, { accountCode: "1199", amount: "100.000.000" }])).rejects.toThrow("Bagian 2: akun 1199");
    await db.period.update({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month: 8 } }, data: { status: "LOCKED", lockedAt: new Date() } });
    await expect(split([{ accountCode: "6100", amount: "120.000.000" }, { accountCode: "5110", amount: "80.000.000" }])).rejects.toThrow(/dikunci|ditutup/);
    expect(await db.bankTxSplit.count()).toBe(0);
  });

  it("a split in a month that is then closed stays put, even re-split with the same parts", async () => {
    const { g, t } = await books();
    const parts = [{ accountCode: "6100", amount: "120.000.000" }, { accountCode: "5110", amount: "80.000.000" }];
    await splitTransaction(db, { bankTxId: t.id, parts });
    await db.period.update({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month: 8 } }, data: { status: "LOCKED", lockedAt: new Date() } });
    await expect(splitTransaction(db, { bankTxId: t.id, parts: parts.map((p) => ({ ...p, memo: "catatan baru" })) })).rejects.toThrow("Agustus 2026 sudah dikunci.");
    expect((await db.bankTxSplit.findMany()).map((p) => p.memo)).toEqual([null, null]);
  });

  it("money in splits into credits; a split line can't settle an invoice, by either path", async () => {
    const g = await makeGroup();
    await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "in.csv", data: file("0,00", "07/08/2026;SETORAN CV PELANGGAN JAYA DP DAN SEWA ALAT;0,00;50.000.000,00;50.000.000,00"), provider: null });
    const t = await db.bankTransaction.findFirstOrThrow({ where: { description: { contains: "PELANGGAN" } } });
    await splitTransaction(db, { bankTxId: t.id, parts: [{ accountCode: "1130", amount: "30.000.000" }, { accountCode: "4100", amount: "20.000.000" }] });
    const bankCode = (await db.account.findUniqueOrThrow({ where: { id: g.pt.banks[0].accountId } })).code;
    expect(await byAccount(t.id, bankCode)).toEqual({ "1130": -30n * J, "4100": -20n * J });
    const inv = await createInvoice(db, { clientId: g.client.id, entityId: g.pt.entity.id, direction: "SALES", contactName: "CV Pelanggan Jaya", number: "INV-9", issueDate: "2026-08-01", dpp: "30000000", counterCode: "4100" });
    const input = { clientId: g.client.id, invoiceId: inv.id, bankTransactionId: t.id };
    for (const run of [settle, settleWithReclass]) await expect(run(db, input)).rejects.toThrow("Mutasi ini dipecah ke beberapa akun, jadi tidak bisa dicocokkan ke faktur.");
    expect(await db.invoiceSettlement.count()).toBe(0);
    expect(await byAccount(t.id, bankCode)).toEqual({ "1130": -30n * J, "4100": -20n * J });
  });

  it("controls read a split line by its parts", () => {
    const line = { amount: -200n * J, accountCode: "6100", description: "TRSF", splits: [{ accountCode: "6100", amount: 120n * J }, { accountCode: "1210", amount: 80n * J }] };
    expect(byPart(line).map((r) => [r.accountCode, r.amount])).toEqual([["6100", -120n * J], ["1210", -80n * J]]);
    expect(byPart(line, new Set(["1210"])).map((r) => r.amount)).toEqual([-80n * J]);
    expect(byPart({ ...line, splits: [] })).toEqual([{ ...line, splits: [] }]);
  });
});
