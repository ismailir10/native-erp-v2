import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { LedgerError, postJournal } from "@/lib/ledger/post";
import { importStatement } from "@/lib/import/pipeline";
import { reviewTransaction } from "@/lib/review";
import { balanceSheet, combinedWorksheet, incomeStatement, trialBalance } from "@/lib/reports/ledger";
import { lockPeriod, runControls } from "@/lib/controls";
import { MockProvider } from "@/lib/ai/provider";
import { dateOnly } from "@/lib/format";

const BCA = (lines: string, opening: string, closing: string) => `Informasi Rekening - Mutasi Rekening
No. rekening : 1111111111
Periode : 01/08/2026 - 31/08/2026

Tanggal Transaksi,Keterangan,Cabang,Jumlah,,Saldo
${lines}
"Saldo Awal : ${opening}"
"Saldo Akhir : ${closing}"
`;

const AUG = BCA(
  [
    `'01/08,"TRSF E-BANKING DB 0108/FTSCY/WS1 PT PAKAN JAYA",'0000,"11,100,000.00",DB,"88,900,000.00"`,
    `'03/08,"TRSF E-BANKING CR 0308/FTSCY/WS2 PT MITRA UNGGAS",'0000,"55,500,000.00",CR,"144,400,000.00"`,
    `'05/08,"TRSF E-BANKING DB 0508/FTSCY/WS3 ANDI WIJAYA",'0000,"5,000,000.00",DB,"139,400,000.00"`,
    `'06/08,"TRSF E-BANKING DB 0608/FTSCY/WS4 CV SUMBER VAKSIN",'0000,"2,000,000.00",DB,"137,400,000.00"`,
    `'31/08,"BIAYA ADM",'0000,"15,000.00",DB,"137,385,000.00"`,
  ].join("\n"),
  "100,000,000.00",
  "137,385,000.00",
);

const BRI = `NOREK;3333333333
TGL_TRAN;DESK_TRAN;MUTASI_DEBET;MUTASI_KREDIT;SALDO_AKHIR_MUTASI
2026-08-05;TRANSFER DARI PT UJI SEJAHTERA;0.00;5000000.00;5000000.00
2026-08-09;INDOMARET BELANJA;250000.00;0.00;4750000.00
`;

async function openingBalances(g: Awaited<ReturnType<typeof makeGroup>>) {
  const acc = async (code: string) => (await db.account.findUniqueOrThrow({ where: { clientId_code: { clientId: g.client.id, code } } })).id;
  const equity = await acc("3100");
  await db.$transaction((tx) =>
    postJournal(tx, {
      entityId: g.pt.entity.id,
      date: dateOnly(2026, 7, 31),
      kind: "OPENING",
      memo: "Saldo awal",
      lines: [
        { accountId: g.pt.banks[0].accountId, debit: 100_000_000n },
        { accountId: equity, credit: 100_000_000n },
      ],
    }),
  );
}

describe("postJournal invariants", () => {
  beforeEach(resetDb);

  it("rejects unbalanced entries and single-line entries", async () => {
    const g = await makeGroup();
    const bank = g.pt.banks[0].accountId;
    await expect(
      db.$transaction((tx) => postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 8, 1), kind: "ADJUSTMENT", memo: "x", lines: [{ accountId: bank, debit: 10n }] })),
    ).rejects.toThrow(LedgerError);
    const other = g.pt.banks[1].accountId;
    await expect(
      db.$transaction((tx) =>
        postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 8, 1), kind: "ADJUSTMENT", memo: "x", lines: [{ accountId: bank, debit: 10n }, { accountId: other, credit: 9n }] }),
      ),
    ).rejects.toThrow(/tidak seimbang/);
  });

  it("DB CHECK blocks a line with both sides even if app logic is bypassed", async () => {
    const g = await makeGroup();
    await expect(
      db.$executeRawUnsafe(`INSERT INTO "JournalLine" (id,"firmId","entryId","entityId","accountId",date,debit,credit) VALUES ('x','f','e','en','${g.pt.banks[0].accountId}','2026-08-01',5,5)`),
    ).rejects.toThrow();
  });
});

describe("import → classify → review → reports → close", () => {
  beforeEach(resetDb);

  it("runs the whole pipeline with balanced books and working controls", async () => {
    const g = await makeGroup();
    await openingBalances(g);
    const mock = new MockProvider({ "CV SUMBER VAKSIN": { accountCode: "5100", confidence: 0.8, taxTag: null, reason: "obat ternak" } });

    const s1 = await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca.csv", data: Buffer.from(AUG), provider: mock });
    expect(s1.rows).toBe(5);
    expect(s1.byMethod.RULE).toBe(2); // PAKAN (client rule) + BIAYA ADM
    expect(s1.byMethod.TRANSFER).toBe(1); // to owner, counterpart not yet imported
    expect(s1.byMethod.AI).toBe(1);
    expect(s1.byMethod.HEURISTIC).toBe(1); // MITRA UNGGAS unknown to mock
    expect(s1.needsReview).toBe(2); // AI + heuristic never auto-post
    expect(mock.calls).toBe(1);

    // PPN split on the PAKAN purchase: 11.1jt gross → 10jt DPP + 1.1jt PPN masukan
    const tb = await trialBalance(db, { clientId: g.client.id, entityIds: [g.pt.entity.id] }, dateOnly(2026, 8, 31));
    const net = (code: string) => tb.find((r) => r.account.code === code)!.net;
    expect(net("5100")).toBe(10_000_000n);
    expect(net("1150")).toBe(1_100_000n);
    expect(net("1999")).toBe(-55_500_000n + 2_000_000n); // suspense holds the two open lines (inflow credits it)

    // Re-import the same file: everything is a duplicate, AI not called again.
    const again = await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca.csv", data: Buffer.from(AUG), provider: mock });
    expect(again.duplicates).toBe(5);
    expect(mock.calls).toBe(1);

    // Review: accept AI suggestion, recode heuristic line as sales with PPN.
    const open = await db.bankTransaction.findMany({ where: { status: "NEEDS_REVIEW" }, orderBy: { date: "asc" } });
    await reviewTransaction(db, { bankTxId: open[0].id, accountCode: "4100", taxTag: "PPN_KELUARAN" });
    await reviewTransaction(db, { bankTxId: open[1].id, accountCode: "5100", taxTag: null });
    const mem = await db.memory.findMany();
    expect(mem.map((m) => m.merchantKey).sort()).toEqual(["CV SUMBER VAKSIN", "PT MITRA UNGGAS"]);

    // Owner side arrives: pairs with the PT's open intercompany half.
    const s2 = await importStatement(db, { bankAccountId: g.owner.banks[0].id, fileName: "bri.csv", data: Buffer.from(BRI), provider: null });
    expect(s2.byMethod.TRANSFER).toBe(1);

    const asOf = dateOnly(2026, 8, 31);
    const scopePt = { clientId: g.client.id, entityIds: [g.pt.entity.id] };
    const tb2 = await trialBalance(db, scopePt, asOf);
    expect(tb2.reduce((s, r) => s + r.net, 0n)).toBe(0n);
    expect(tb2.find((r) => r.account.code === "1999")!.net).toBe(0n);
    const is = await incomeStatement(db, scopePt, dateOnly(2026, 8, 1), asOf);
    expect(is.totals.revenue).toBe(50_000_000n); // 55.5jt gross / 1.11
    const bs = await balanceSheet(db, scopePt, asOf);
    expect(bs.totals.difference).toBe(0n);

    const ws = await combinedWorksheet(db, g.client.id, asOf);
    expect(ws.matched).toBe(5_000_000n);
    expect(ws.residual).toBe(0n);

    const controls = await runControls(db, g.client.id, 2026, 8);
    const byKey = Object.fromEntries(controls.map((c) => [c.key, c.status]));
    expect(byKey[`bank:${g.pt.banks[0].id}`]).toBe("PASS");
    expect(byKey[`bank:${g.pt.banks[1].id}`]).toBe("REVIEW"); // Mandiri not imported
    expect(byKey.intercompany).toBe("PASS");
    expect(controls.some((c) => c.status === "FAIL")).toBe(false);

    // The owner's "INDOMARET" line is open (heuristic) → close is blocked until reviewed + acked.
    await expect(lockPeriod(db, g.client.id, 2026, 8, "x")).rejects.toThrow(/Belum bisa tutup buku/);
  });
});
