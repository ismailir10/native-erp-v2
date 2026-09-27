import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { makePdf, table } from "../pdf-fixture";
import { importStatement } from "@/lib/import/pipeline";
import { reviewTransaction } from "@/lib/review";
import { cachedCloseReview, reviewClose } from "@/lib/controls/ai-review";
import { MockProvider, type AiProvider, type CloseReviewInput } from "@/lib/ai/provider";
import ExcelJS from "exceljs";
import { importSourceAccounts, postImport, stageImport } from "@/lib/ledger-import/post";
import { acceptMappings, suggestMappings } from "@/lib/ledger-import/mapping";

const statement = makePdf([
  [
    ...table(800, [[[40, "PT Bank Mandiri (Persero) Tbk"]], [[40, "Nomor Rekening : 2222222222"]], [[40, "Periode : 01/08/2026 - 31/08/2026"]]]),
    ...table(740, [
      [[40, "Tanggal"], [130, "Keterangan"], [360, "Debit"], [440, "Kredit"], [520, "Saldo"]],
      [[40, "01/08/2026"], [130, "SALDO AWAL"], [500, "0,00"]],
      [[40, "04/08/2026"], [130, "PENCAIRAN PINJAMAN KMK"], [430, "100.000.000,00"], [510, "100.000.000,00"]],
    ]),
  ],
]);

async function flaggedMonth() {
  const g = await makeGroup();
  await importStatement(db, { bankAccountId: g.pt.banks[1].id, fileName: "mandiri.pdf", data: statement, provider: null });
  const tx = await db.bankTransaction.findFirstOrThrow({ where: { entityId: g.pt.entity.id } });
  await reviewTransaction(db, { bankTxId: tx.id, accountCode: tx.suggestedCode!, taxTag: null });
  return { g, tx };
}

describe("AI close review", () => {
  beforeEach(resetDb);

  it("explains flagged controls citing their rows, pays once, then serves the cache", async () => {
    const { g, tx } = await flaggedMonth();
    const provider = new MockProvider();
    const r = await reviewClose(db, g.firm.id, g.client.id, 2026, 8, provider);
    const financing = r.items.find((i) => i.controlKey === `pl-financing:${g.pt.entity.id}`)!;
    expect(financing.refs).toEqual([tx.id]);
    expect(financing.links[0].href).toBe(`/clients/${g.client.id}/ledger/4100?period=2026-08&entity=${g.pt.entity.id}`);
    expect(r.items.every((i) => i.status === "REVIEW" || i.status === "FAIL")).toBe(true);
    expect(provider.calls).toBe(1);

    const usage = await db.aiUsage.findMany();
    expect(usage.map((u) => [u.ok, u.model])).toEqual([[true, "mock"]]);
    expect(await db.aiReservation.count({ where: { settled: false } })).toBe(0);

    await reviewClose(db, g.firm.id, g.client.id, 2026, 8, provider);
    expect(provider.calls).toBe(1);
    expect((await cachedCloseReview(db, g.firm.id, g.client.id, 2026, 8, "mock"))?.items.length).toBe(r.items.length);
    expect(await cachedCloseReview(db, g.firm.id, g.client.id, 2026, 8, "other-model")).toBeNull();

    // The accountant reclassifies: the flagged set changes, the old review no longer applies.
    await reviewTransaction(db, { bankTxId: tx.id, accountCode: "2210", taxTag: null });
    expect(await cachedCloseReview(db, g.firm.id, g.client.id, 2026, 8, "mock")).toBeNull();
  });

  it("never posts, acks or locks", async () => {
    const { g } = await flaggedMonth();
    const before = { entries: await db.journalEntry.count(), acks: await db.controlAck.count(), signoffs: await db.closeSignoff.count() };
    await reviewClose(db, g.firm.id, g.client.id, 2026, 8, new MockProvider());
    expect({ entries: await db.journalEntry.count(), acks: await db.controlAck.count(), signoffs: await db.closeSignoff.count() }).toEqual(before);
    expect((await db.period.findFirst({ where: { clientId: g.client.id, year: 2026, month: 8 } }))?.status ?? "OPEN").toBe("OPEN");
  });

  it("logs a failed call and keeps nothing in the cache", async () => {
    const { g } = await flaggedMonth();
    const broken: AiProvider = { model: "broken", classify: async () => { throw new Error("x"); }, mapAccounts: async () => { throw new Error("x"); }, reviewClose: async () => { throw new Error("AI 500: down"); } };
    await expect(reviewClose(db, g.firm.id, g.client.id, 2026, 8, broken)).rejects.toThrow(/AI 500/);
    expect((await db.aiUsage.findMany()).map((u) => u.ok)).toEqual([false]);
    expect(await db.evidenceAiCache.count()).toBe(0);
  });

  it("shows the client's own accounts behind a ledger-fed balance against its nature", async () => {
    const g = await makeGroup();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("GL");
    ws.addRow(["Entity", "Entry Date", "Account Code", "Account Name", "Debit", "Credit"]);
    ws.addRow(["PT Uji", new Date(Date.UTC(2026, 7, 31)), "10000", "Kas", 900, 0]);
    ws.addRow(["PT Uji", new Date(Date.UTC(2026, 7, 31)), "21500", "Hutang Pemegang Saham", 0, 900]);
    const st = await stageImport(db, { firmId: g.firm.id, clientId: g.client.id, fileName: "gl.xlsx", data: Buffer.from(await wb.xlsx.writeBuffer()) });
    if (st.status !== "STAGED") throw new Error("not staged");
    await suggestMappings(db, { firmId: g.firm.id, clientId: g.client.id, provider: null, useAi: false });
    const src = await importSourceAccounts(db, st.importId);
    // Mis-mapped on purpose: the shareholder loan lands in receivables.
    await acceptMappings(db, g.client.id, src.map((x) => ({ sourceAccountId: x.id, accountCode: x.code === "10000" ? "1120" : "1140", method: "MANUAL" as const })));
    await postImport(db, g.client.id, st.importId);

    let seen: CloseReviewInput | null = null;
    const provider = new MockProvider();
    const spy: AiProvider = { model: "mock", classify: provider.classify.bind(provider), mapAccounts: provider.mapAccounts.bind(provider), reviewClose: async (input) => ((seen = input), provider.reviewClose(input)) };
    const r = await reviewClose(db, g.firm.id, g.client.id, 2026, 8, spy);
    const nature = seen!.controls.find((c) => c.key === `nature:${g.pt.entity.id}`)!;
    expect(nature.rows.map((x) => [x.text, x.amount, x.how])).toEqual([["Akun sumber 21500 Hutang Pemegang Saham", "-Rp 900", "dipetakan ke 1140, jenis di file LIABILITAS"]]);
    expect(r.items.find((i) => i.controlKey === nature.key)!.links[0].href).toBe(`/clients/${g.client.id}/trial-balance?view=source&entity=${g.pt.entity.id}&period=2026-08`);
  });

  it("sends only the bank lines behind the flagged accounts", async () => {
    const g = await makeGroup();
    const pdf = makePdf([
      [
        ...table(800, [[[40, "PT Bank Mandiri (Persero) Tbk"]], [[40, "Nomor Rekening : 2222222222"]], [[40, "Periode : 01/08/2026 - 31/08/2026"]]]),
        ...table(740, [
          [[40, "Tanggal"], [130, "Keterangan"], [360, "Debit"], [440, "Kredit"], [520, "Saldo"]],
          [[40, "01/08/2026"], [130, "SALDO AWAL"], [500, "0,00"]],
          [[40, "04/08/2026"], [130, "TRANSFER DARI PT MITRA"], [430, "10.000.000,00"], [510, "10.000.000,00"]],
          [[40, "05/08/2026"], [130, "BAYAR SEWA DIMUKA"], [360, "4.000.000,00"], [520, "6.000.000,00"]],
        ]),
      ],
    ]);
    await importStatement(db, { bankAccountId: g.pt.banks[1].id, fileName: "m.pdf", data: pdf, provider: null });
    const [inTx, outTx] = await db.bankTransaction.findMany({ where: { entityId: g.pt.entity.id }, orderBy: { date: "asc" } });
    await reviewTransaction(db, { bankTxId: inTx.id, accountCode: "1130", taxTag: null }); // receivable credited: flagged
    await reviewTransaction(db, { bankTxId: outTx.id, accountCode: "1170", taxTag: null }); // prepaid debited: normal, unrelated

    let seen: CloseReviewInput | null = null;
    const provider = new MockProvider();
    await reviewClose(db, g.firm.id, g.client.id, 2026, 8, { model: "mock", classify: provider.classify.bind(provider), mapAccounts: provider.mapAccounts.bind(provider), reviewClose: async (i) => ((seen = i), provider.reviewClose(i)) });
    const nature = seen!.controls.find((c) => c.key === `nature:${g.pt.entity.id}`)!;
    expect(nature.rows.map((r) => r.id)).toEqual([inTx.id]);
  });

  it("explains a negative asset total with the lines that moved it, not asset-to-asset transfers", async () => {
    const g = await makeGroup();
    const pdf = makePdf([
      [
        ...table(800, [[[40, "PT Bank Mandiri (Persero) Tbk"]], [[40, "Nomor Rekening : 2222222222"]], [[40, "Periode : 01/08/2026 - 31/08/2026"]]]),
        ...table(740, [
          [[40, "Tanggal"], [130, "Keterangan"], [360, "Debit"], [440, "Kredit"], [520, "Saldo"]],
          [[40, "01/08/2026"], [130, "SALDO AWAL"], [500, "0,00"]],
          [[40, "04/08/2026"], [130, "BAYAR JASA KONSULTAN"], [360, "4.000.000,00"], [520, "-4.000.000,00"]],
          [[40, "05/08/2026"], [130, "BAYAR SEWA DIMUKA"], [360, "1.000.000,00"], [520, "-5.000.000,00"]],
        ]),
      ],
    ]);
    await importStatement(db, { bankAccountId: g.pt.banks[1].id, fileName: "m.pdf", data: pdf, provider: null });
    const [fee, prepaid] = await db.bankTransaction.findMany({ where: { entityId: g.pt.entity.id }, orderBy: { date: "asc" } });
    await reviewTransaction(db, { bankTxId: fee.id, accountCode: "6170", taxTag: null }); // expense: lowers total assets
    await reviewTransaction(db, { bankTxId: prepaid.id, accountCode: "1170", taxTag: null }); // bank → prepaid: total unchanged

    let seen: CloseReviewInput | null = null;
    const provider = new MockProvider();
    await reviewClose(db, g.firm.id, g.client.id, 2026, 8, { model: "mock", classify: provider.classify.bind(provider), mapAccounts: provider.mapAccounts.bind(provider), reviewClose: async (i) => ((seen = i), provider.reviewClose(i)) });
    const total = seen!.controls.find((c) => c.key === `nature-total:${g.pt.entity.id}`)!;
    expect(total.status).toBe("FAIL");
    expect(total.rows.map((r) => r.id)).toEqual([fee.id]);
  });

  it("caps a control's rows across all its batches and scopes account rows to their entity", async () => {
    const g = await makeGroup();
    const lines: [number, string][][] = [[[40, "Tanggal"], [130, "Keterangan"], [360, "Debit"], [440, "Kredit"], [520, "Saldo"]], [[40, "01/08/2026"], [130, "SALDO AWAL"], [500, "0,00"]]];
    lines.push([[40, "02/08/2026"], [130, "TRANSFER DARI PT MITRA"], [430, "1.000.000,00"], [510, "1.000.000,00"]]);
    let balance = 1_000_000;
    for (let d = 3; d <= 14; d++) {
      balance -= 500_000;
      const bal = (balance < 0 ? "-" : "") + Math.abs(balance).toLocaleString("id-ID") + ",00";
      lines.push([[40, `${String(d).padStart(2, "0")}/08/2026`], [130, `BAYAR JASA ${d}`], [360, "500.000,00"], [520, bal]]);
    }
    const pdf = makePdf([[...table(800, [[[40, "PT Bank Mandiri (Persero) Tbk"]], [[40, "Nomor Rekening : 2222222222"]], [[40, "Periode : 01/08/2026 - 31/08/2026"]]]), ...table(740, lines)]]);
    await importStatement(db, { bankAccountId: g.pt.banks[1].id, fileName: "m.pdf", data: pdf, provider: null });
    const txs = await db.bankTransaction.findMany({ where: { entityId: g.pt.entity.id }, orderBy: { date: "asc" } });
    expect(txs).toHaveLength(13);
    await reviewTransaction(db, { bankTxId: txs[0].id, accountCode: "1130", taxTag: null }); // receivable credited → negative asset account
    for (const t of txs.slice(1)) await reviewTransaction(db, { bankTxId: t.id, accountCode: "6170", taxTag: null });

    let seen: CloseReviewInput | null = null;
    const provider = new MockProvider();
    await reviewClose(db, g.firm.id, g.client.id, 2026, 8, { model: "mock", classify: provider.classify.bind(provider), mapAccounts: provider.mapAccounts.bind(provider), reviewClose: async (i) => ((seen = i), provider.reviewClose(i)) });
    const total = seen!.controls.find((c) => c.key === `nature-total:${g.pt.entity.id}`)!;
    expect(total.rows).toHaveLength(10); // account summary + bank lines share one allowance
    expect(total.rows[0].id).toBe(`akun:${g.pt.entity.id}:1130`);
  });
});
