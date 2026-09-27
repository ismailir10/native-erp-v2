import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { makePdf, table } from "../pdf-fixture";
import { importStatement } from "@/lib/import/pipeline";
import { reviewTransaction } from "@/lib/review";
import { explainControl } from "@/lib/controls/explain";
import { postProposal, proposalViews } from "@/lib/adjust/proposals";
import { runControls } from "@/lib/controls";
import { MockProvider, parseControlExplain, type AiProvider } from "@/lib/ai/provider";

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

/** A loan drawdown the accountant booked to revenue: the `pl-financing` control flags it. */
async function loanInRevenue() {
  const g = await makeGroup();
  await importStatement(db, { bankAccountId: g.pt.banks[1].id, fileName: "mandiri.pdf", data: statement, provider: null });
  const tx = await db.bankTransaction.findFirstOrThrow({ where: { entityId: g.pt.entity.id } });
  await reviewTransaction(db, { bankTxId: tx.id, accountCode: "4100", taxTag: null });
  return { g, tx, key: `pl-financing:${g.pt.entity.id}` };
}

describe("close copilot — Jelaskan", () => {
  beforeEach(resetDb);

  it("explains one control, stores a grounded draft once, serves the cache, and posts only on the click", async () => {
    const { g, tx, key } = await loanInRevenue();
    const provider = new MockProvider();
    const before = { entries: await db.journalEntry.count(), acks: await db.controlAck.count(), signoffs: await db.closeSignoff.count() };
    const r = await explainControl(db, g.firm.id, g.client.id, 2026, 8, key, provider);
    expect(r.explanation).toBe("Uji: Pinjaman / modal / pindah dana tercatat di Laba Rugi");
    expect(r.note).toBe("Dicek: Pinjaman / modal / pindah dana tercatat di Laba Rugi");
    expect(r.links.map((l) => l.id)).toEqual([tx.id]);
    const p = await db.proposedEntry.findUniqueOrThrow({ where: { id: r.proposal!.id } });
    expect([p.status, p.source, p.controlKey, p.entityId, p.year, p.month, p.lines]).toEqual([
      "PROPOSED", "AI_CONTROL", key, g.pt.entity.id, 2026, 8,
      [{ accountCode: "4100", debit: "100000000", credit: "0" }, { accountCode: "2210", debit: "0", credit: "100000000" }],
    ]);

    const again = await explainControl(db, g.firm.id, g.client.id, 2026, 8, key, provider);
    expect([provider.calls, await db.aiUsage.count(), await db.proposedEntry.count(), again.proposal?.id]).toEqual([1, 1, 1, p.id]);
    expect({ entries: await db.journalEntry.count(), acks: await db.controlAck.count(), signoffs: await db.closeSignoff.count() }).toEqual(before);

    // The draft moves a cited bank line: it posts through the reviewer's writer, re-coding the line (rule 3), not as a free journal.
    expect(p.bankTransactionId).toBe(tx.id);
    const entry = await postProposal(db, { clientId: g.client.id, proposalId: p.id });
    expect(entry.kind).toBe("RECLASS");
    expect((await db.bankTransaction.findUniqueOrThrow({ where: { id: tx.id } })).accountCode).toBe("2210");
    expect((await db.proposedEntry.findUniqueOrThrow({ where: { id: p.id } })).entryId).toBe(entry.id);
    expect((await runControls(db, g.client.id, 2026, 8)).find((c) => c.key === key)).toBeUndefined(); // revenue no longer holds the loan
    await expect(postProposal(db, { clientId: g.client.id, proposalId: p.id })).rejects.toThrow("sudah dicatat");
  });

  it("gives a group-level control words only, and refuses a control that passes", async () => {
    const { g } = await loanInRevenue();
    const provider = new MockProvider();
    await db.bankTransaction.updateMany({ data: { status: "NEEDS_REVIEW" } }); // a line back in the review queue flags `suspense`
    const r = await explainControl(db, g.firm.id, g.client.id, 2026, 8, "suspense", provider);
    expect([r.proposal, await db.proposedEntry.count()]).toEqual([null, 0]);
    await expect(explainControl(db, g.firm.id, g.client.id, 2026, 8, `tb:${g.pt.entity.id}`, provider)).rejects.toThrow("sudah lolos");
    await expect(explainControl(db, g.firm.id, g.client.id, 2026, 8, "bukan-kontrol", provider)).rejects.toThrow("tidak ditemukan");
  });

  it("refuses to change the bank line's own account, and posts a re-targeted reclass", async () => {
    const { g, tx, key } = await loanInRevenue();
    const r = await explainControl(db, g.firm.id, g.client.id, 2026, 8, key, new MockProvider());
    await expect(postProposal(db, { clientId: g.client.id, proposalId: r.proposal!.id, accounts: ["6190", "2210"] })).rejects.toThrow("akun transaksi saat ini");
    await postProposal(db, { clientId: g.client.id, proposalId: r.proposal!.id, accounts: ["4100", "2300"] }); // the accountant knows it's long-term
    expect((await db.bankTransaction.findUniqueOrThrow({ where: { id: tx.id } })).accountCode).toBe("2300");
  });

  it("moves only the bank line the draft cites, refuses a draft the books have moved past, and releases a tax split", async () => {
    const g = await makeGroup();
    const twin = makePdf([
      [
        ...table(800, [[[40, "PT Bank Mandiri (Persero) Tbk"]], [[40, "Nomor Rekening : 2222222222"]], [[40, "Periode : 01/08/2026 - 31/08/2026"]]]),
        ...table(740, [
          [[40, "Tanggal"], [130, "Keterangan"], [360, "Debit"], [440, "Kredit"], [520, "Saldo"]],
          [[40, "01/08/2026"], [130, "SALDO AWAL"], [500, "0,00"]],
          [[40, "04/08/2026"], [130, "PENCAIRAN PINJAMAN KMK"], [430, "100.000.000,00"], [510, "100.000.000,00"]],
          [[40, "05/08/2026"], [130, "PENCAIRAN PINJAMAN KMK"], [430, "100.000.000,00"], [510, "200.000.000,00"]],
        ]),
      ],
    ]);
    await importStatement(db, { bankAccountId: g.pt.banks[1].id, fileName: "m.pdf", data: twin, provider: null });
    const [first, second] = await db.bankTransaction.findMany({ where: { entityId: g.pt.entity.id }, orderBy: { date: "asc" } });
    await reviewTransaction(db, { bankTxId: first.id, accountCode: "4100", taxTag: null });
    await reviewTransaction(db, { bankTxId: second.id, accountCode: "4100", taxTag: "PPN_KELUARAN" }); // wrongly taxed too
    const key = `pl-financing:${g.pt.entity.id}`;
    const citing = (ids: string[]): AiProvider => ({
      model: "mock",
      classify: async () => ({ answers: [], promptTokens: 0, completionTokens: 0, model: "mock" }),
      mapAccounts: async () => ({ answers: [], promptTokens: 0, completionTokens: 0, model: "mock" }),
      explainControl: async (input) => {
        const entry = { memo: "Reklasifikasi pinjaman", lines: [{ accountCode: "4100", side: "D", amount: "Rp 100.000.000" }, { accountCode: "2210", side: "K", amount: "Rp 100.000.000" }] };
        return { ...parseControlExplain(JSON.stringify({ explanation: "Pinjaman di pendapatan.", suggestion: "Reklasifikasi.", refs: ids, note: "", entry }), input), promptTokens: 1, completionTokens: 1, model: "mock" };
      },
    });

    // Both lines cited and both fit: which one to move is ambiguous, so no draft is stored.
    const both = await explainControl(db, g.firm.id, g.client.id, 2026, 8, key, citing([first.id, second.id]));
    expect([both.proposal, await db.proposedEntry.count()]).toEqual([null, 0]);

    // One cited → that one, even though the other has the lower id. (Same books: clear the cached answer to ask again.)
    await db.evidenceAiCache.deleteMany();
    const one = await explainControl(db, g.firm.id, g.client.id, 2026, 8, key, citing([second.id]));
    const p = await db.proposedEntry.findUniqueOrThrow({ where: { id: one.proposal!.id } });
    expect(p.bankTransactionId).toBe(second.id);
    const [view] = await proposalViews(db, g.client.id, 2026, 8);
    expect(view.reason).toMatch(/Tag pajak transaksi ini dilepas saat dicatat/);

    // Posting releases the tax split: the whole Rp 100 jt lands on 2210, no PPN left behind.
    await postProposal(db, { clientId: g.client.id, proposalId: p.id });
    const moved = await db.bankTransaction.findUniqueOrThrow({ where: { id: second.id } });
    expect([moved.accountCode, moved.taxTag]).toEqual(["2210", null]);
    const net = async (code: string) => {
      const s = await db.journalLine.aggregate({ where: { entityId: g.pt.entity.id, account: { code } }, _sum: { debit: true, credit: true } });
      return (s._sum.credit ?? 0n) - (s._sum.debit ?? 0n);
    };
    expect([await net("2210"), await net("2130")]).toEqual([100_000_000n, 0n]);

    // A draft for the first line, then the accountant fixes that line in Review: the books moved, the draft can't post.
    const stale = await explainControl(db, g.firm.id, g.client.id, 2026, 8, key, citing([first.id]));
    await reviewTransaction(db, { bankTxId: first.id, accountCode: "2210", taxTag: null });
    const entries = await db.journalEntry.count();
    await expect(postProposal(db, { clientId: g.client.id, proposalId: stale.proposal!.id })).rejects.toThrow("Buku berubah sejak draf ini dibuat");
    expect(await db.journalEntry.count()).toBe(entries); // nothing posted twice
  });
});

