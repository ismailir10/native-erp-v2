import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { dismissProposal, openProposals, postProposal, saveProposal, type NewProposal } from "@/lib/adjust/proposals";

const draft = (g: Awaited<ReturnType<typeof makeGroup>>, over: Partial<NewProposal> = {}): NewProposal => ({
  firmId: g.firm.id,
  clientId: g.client.id,
  entityId: g.pt.entity.id,
  year: 2026,
  month: 8,
  // The posting mechanics are the same for every source; AI drafts add a freshness check (tests/db/close-explain.test.ts).
  source: "SUSPENSE",
  controlKey: null,
  key: "uji-1",
  memo: "Reklasifikasi pencairan pinjaman KMK",
  lines: [{ accountCode: "4100", debit: "100000000", credit: "0" }, { accountCode: "2120", debit: "0", credit: "100000000" }],
  reason: "Pencairan pinjaman bukan penjualan",
  refs: ["tx-1"],
  ...over,
});

describe("proposed entries", () => {
  beforeEach(resetDb);

  it("stores one proposal per key and lists the open ones of the period", async () => {
    const g = await makeGroup();
    const a = await saveProposal(db, draft(g));
    const b = await saveProposal(db, draft(g, { memo: "lagi" }));
    expect(b.id).toBe(a.id);
    expect((await openProposals(db, g.client.id, 2026, 8)).map((p) => [p.memo, p.entity.shortName])).toEqual([["Reklasifikasi pencairan pinjaman KMK", "PT Uji"]]);
    expect(await openProposals(db, g.client.id, 2026, 9)).toEqual([]);
  });

  it("posts on the accountant's click with an edited account, once", async () => {
    const g = await makeGroup();
    const p = await saveProposal(db, draft(g));
    const results = await Promise.allSettled([1, 2].map(() => postProposal(db, { clientId: g.client.id, proposalId: p.id, accounts: ["4100", "2210"] })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const after = await db.proposedEntry.findUniqueOrThrow({ where: { id: p.id }, include: { entry: { include: { lines: { include: { account: true } } } } } });
    expect(after.status).toBe("POSTED");
    expect([after.entry!.kind, after.entry!.date.toISOString().slice(0, 10), after.entry!.memo]).toEqual(["ADJUSTMENT", "2026-08-31", "Reklasifikasi pencairan pinjaman KMK"]);
    expect(after.entry!.lines.map((l) => [l.account.code, l.debit, l.credit])).toEqual([["4100", 100_000_000n, 0n], ["2210", 0n, 100_000_000n]]);
    await expect(postProposal(db, { clientId: g.client.id, proposalId: p.id })).rejects.toThrow("sudah dicatat");
    expect(await db.journalEntry.count()).toBe(1);
  });

  it("refuses bank or unknown accounts, a missing account, a locked period and another client", async () => {
    const g = await makeGroup();
    const other = await makeGroup();
    const p = await saveProposal(db, draft(g));
    const bank = await db.account.findFirstOrThrow({ where: { clientId: g.client.id, isBank: true } });
    await expect(postProposal(db, { clientId: g.client.id, proposalId: p.id, accounts: ["4100", bank.code] })).rejects.toThrow("akun bank");
    await expect(postProposal(db, { clientId: g.client.id, proposalId: p.id, accounts: ["4100", "9999"] })).rejects.toThrow("Akun 9999 tidak ada");
    await expect(postProposal(db, { clientId: g.client.id, proposalId: p.id, accounts: ["4100", ""] })).rejects.toThrow("Pilih akun");
    await expect(postProposal(db, { clientId: g.client.id, proposalId: p.id, accounts: ["4100"] })).rejects.toThrow("Jumlah akun");
    await expect(postProposal(db, { clientId: other.client.id, proposalId: p.id })).rejects.toThrow("tidak ditemukan");
    await db.period.upsert({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month: 8 } }, create: { firmId: g.firm.id, clientId: g.client.id, year: 2026, month: 8, status: "LOCKED" }, update: { status: "LOCKED" } });
    await expect(postProposal(db, { clientId: g.client.id, proposalId: p.id })).rejects.toThrow("sudah ditutup");
    expect((await db.proposedEntry.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("PROPOSED");
  });

  it("dismisses once and never posts a dismissed proposal", async () => {
    const g = await makeGroup();
    const p = await saveProposal(db, draft(g));
    await dismissProposal(db, { clientId: g.client.id, proposalId: p.id });
    await expect(dismissProposal(db, { clientId: g.client.id, proposalId: p.id })).rejects.toThrow("sudah diputuskan");
    await expect(postProposal(db, { clientId: g.client.id, proposalId: p.id })).rejects.toThrow("sudah diabaikan");
    expect(await openProposals(db, g.client.id, 2026, 8)).toEqual([]);
  });

  it("refuses an AI draft that carries no snapshot of the rows it was made from", async () => {
    const g = await makeGroup();
    const p = await saveProposal(db, draft(g, { source: "AI_CONTROL", controlKey: `pl-financing:${g.pt.entity.id}`, key: "ai-lama" }));
    await expect(postProposal(db, { clientId: g.client.id, proposalId: p.id })).rejects.toThrow("Buku berubah sejak draf ini dibuat");
    expect(await db.journalEntry.count()).toBe(0);
  });
});

