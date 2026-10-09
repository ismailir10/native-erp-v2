import { beforeEach, describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { financialStatementsPdf } from "@/lib/reports/pdf";
import { dateOnly } from "@/lib/format";

/** The PDF a partner sends: a note table that runs onto a new page repeats its header there, no "." alone on a line, the draft reasons once. */
describe("statements PDF layout", () => {
  beforeEach(resetDb);

  it("repeats a continued note table's header, keeps punctuation with a blank and prints the draft reasons on the first page only", async () => {
    const g = await makeGroup();
    // 70 expense accounts under one line: its CALK table cannot fit on one page.
    const ids: string[] = [];
    for (let i = 0; i < 70; i++) {
      const a = await db.account.create({ data: { firmId: g.firm.id, clientId: g.client.id, code: `6${String(500 + i)}`, name: `Beban operasional uji nomor ${i + 1}`, type: "BEBAN", normalBalance: "DEBIT", fsLine: "BEBAN_UMUM_ADM" } });
      ids.push(a.id);
    }
    const cash = g.pt.banks[0].accountId;
    const capital = (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code: "3100" } })).id;
    await db.$transaction(async (tx) => {
      await postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 3, 1), kind: "ADJUSTMENT", memo: "modal", lines: [{ accountId: cash, debit: 100_000_000n }, { accountId: capital, credit: 100_000_000n }] });
      await postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 3, 15), kind: "ADJUSTMENT", memo: "beban", lines: [...ids.map((accountId, i) => ({ accountId, debit: BigInt(10_000 * (i + 1)) })), { accountId: cash, credit: ids.reduce((t, _, i) => t + BigInt(10_000 * (i + 1)), 0n) }] });
    });
    const buf = await financialStatementsPdf(db, { clientId: g.client.id, entityIds: [g.pt.entity.id] }, 2026, 3, { firm: "KJA Uji", title: "PT Uji", draft: "1 transaksi masih di Review." });
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(buf)), { mergePages: false });
    if (process.env.PDF_OUT) (await import("node:fs")).writeFileSync(process.env.PDF_OUT, buf);

    const withRow = (n: number) => text.findIndex((p) => p.includes(`Beban operasional uji nomor ${n} `) || p.endsWith(`Beban operasional uji nomor ${n}`));
    const [first, last] = [withRow(1), withRow(70)];
    expect(last).toBeGreaterThan(first); // the table spans pages
    for (let p = first + 1; p <= last; p++) expect(text[p], `page ${p + 1}`).toMatch(/Akun\s+1 Januari – 31 Maret/);

    expect(text[0]).toContain("DRAF — 1 transaksi masih di Review.");
    for (const p of text.slice(1)) {
      expect(p).toContain("DRAF — lihat halaman 1");
      expect(p).not.toContain("1 transaksi masih di Review");
    }
    for (const p of text) expect(p.split("\n").some((l) => l.trim() === ".")).toBe(false);
  });
});
