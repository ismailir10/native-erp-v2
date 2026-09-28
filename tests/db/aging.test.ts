import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { importStatement } from "@/lib/import/pipeline";
import { createInvoice } from "@/lib/receivables/invoices";
import { settleWithReclass } from "@/lib/receivables/settle";
import { agingByContact, bucketOf, invoicesAt, subledgerVsLedger } from "@/lib/receivables/aging";
import { reviewTransaction } from "@/lib/review";
import { runControls } from "@/lib/controls";
import { dateOnly } from "@/lib/format";

type G = Awaited<ReturnType<typeof makeGroup>>;
const CSV = ["Tanggal;Keterangan;Debet;Kredit;Saldo", "20/09/2026;TRSF CR PT MITRA UNGGAS;0;4000000;104000000", "25/09/2026;TRSF CR TOKO BARU;0;700000;104700000", ""].join("\n");
const inv = (g: G, number: string, contactName: string, total: string, issueDate: string, dueDate: string) =>
  createInvoice(db, { clientId: g.client.id, entityId: g.pt.entity.id, direction: "SALES", contactName, number, issueDate, dueDate, dpp: total, counterCode: "4100" });

describe("aging and the receivable control", () => {
  beforeEach(resetDb);

  it("buckets open amounts by days past due at the date, ignoring later settlements", async () => {
    expect([0, 1, 30, 31, 60, 61, 90, 91].map(bucketOf)).toEqual(["CURRENT", "D1_30", "D1_30", "D31_60", "D31_60", "D61_90", "D61_90", "OVER_90"]);
    const g = await makeGroup();
    await inv(g, "A-1", "PT Mitra Unggas", "10000000", "2026-05-01", "2026-05-31"); // 122 days past due at 30 Sep
    await inv(g, "A-2", "PT Mitra Unggas", "4000000", "2026-08-01", "2026-08-31"); // 30 days
    await inv(g, "B-1", "Toko Baru", "2000000", "2026-09-10", "2026-10-10"); // not due
    await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca.csv", data: Buffer.from(CSV), provider: null });
    const receipt = await db.bankTransaction.findFirstOrThrow({ where: { description: { contains: "MITRA" } } });
    const a2 = await db.invoice.findFirstOrThrow({ where: { number: "A-2" } });
    await settleWithReclass(db, { clientId: g.client.id, invoiceId: a2.id, bankTransactionId: receipt.id });

    const sep = agingByContact(await invoicesAt(db, g.client.id, "SALES", dateOnly(2026, 9, 30)));
    expect(sep.map((r) => [r.contact.name, r.buckets.CURRENT, r.buckets.D1_30, r.buckets.OVER_90, r.total])).toEqual([
      ["PT Mitra Unggas", 0n, 0n, 10_000_000n, 10_000_000n],
      ["Toko Baru", 2_000_000n, 0n, 0n, 2_000_000n],
    ]);
    // At 31 Aug the September receipt hasn't happened: A-2 is still open (due that day), B-1 not issued yet.
    const aug = agingByContact(await invoicesAt(db, g.client.id, "SALES", dateOnly(2026, 8, 31)));
    // (A-1: 31 May → 31 Aug is 92 days.)
    expect(aug.map((r) => [r.contact.name, r.buckets.CURRENT, r.buckets.OVER_90, r.total])).toEqual([["PT Mitra Unggas", 4_000_000n, 10_000_000n, 14_000_000n]]);
  });

  it("passes when open invoices equal 1130 and names the unsettled receipts when they don't", async () => {
    const g = await makeGroup();
    const control = async (month: number) => (await runControls(db, g.client.id, 2026, month)).find((c) => c.key === `ar:${g.pt.entity.id}`);
    expect(await control(9)).toBeUndefined();
    const a = await inv(g, "A-2", "PT Mitra Unggas", "4000000", "2026-09-01", "2026-09-30");
    await inv(g, "B-1", "Toko Baru", "700000", "2026-09-10", "2026-10-10");
    expect(await control(9)).toMatchObject({ status: "PASS", detail: "Piutang terbuka Rp 4.700.000 (1130)" });
    await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca.csv", data: Buffer.from(CSV), provider: null });
    // One receipt settles A-2; the other is classified to 1130 but not matched to B-1 yet.
    await settleWithReclass(db, { clientId: g.client.id, invoiceId: a.id, bankTransactionId: (await db.bankTransaction.findFirstOrThrow({ where: { description: { contains: "MITRA" } } })).id });
    await reviewTransaction(db, { bankTxId: (await db.bankTransaction.findFirstOrThrow({ where: { description: { contains: "TOKO BARU" } } })).id, accountCode: "1130", taxTag: null });
    const c = await control(9);
    expect(c?.status).toBe("REVIEW");
    expect(c?.detail).toBe("Piutang terbuka: daftar Rp 700.000 vs buku besar Rp 0 (1130); 1 mutasi bank di akun itu belum dicocokkan ke faktur");
    expect((await subledgerVsLedger(db, g.client.id, "SALES", dateOnly(2026, 9, 30)))[0]).toMatchObject({ subledger: 700_000n, ledger: 0n, unsettledLines: 1, equal: false });
  });
});
