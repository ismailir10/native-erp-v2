import { beforeEach, describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { standardFormat } from "@/lib/reports/format";
import { financialStatementsPdf, printedValues, winAnsi } from "@/lib/reports/pdf";
import { dateOnly } from "@/lib/format";

/** UC-K3: the send-ready PDF — the client's format, a header and page number on every page, DRAF while open, totals of the printed lines. */
describe("statements PDF", () => {
  beforeEach(resetDb);

  it("prints every statement in the client's format with its header, unit, DRAF line and page numbers", async () => {
    const g = await makeGroup();
    const acc = async (code: string) => (await db.account.findUniqueOrThrow({ where: { clientId_code: { clientId: g.client.id, code } } })).id;
    await db.$transaction(async (tx) => {
      const post = async (lines: [string, bigint, bigint][]) =>
        postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 3, 15), kind: "ADJUSTMENT", memo: "uji", lines: await Promise.all(lines.map(async ([c, d, k]) => ({ accountId: await acc(c), debit: d, credit: k }))) });
      await post([["1110", 10_000_400n, 0n], ["3100", 0n, 10_000_400n]]);
      await post([["1130", 5_000_600n, 0n], ["4100", 0n, 5_000_600n]]);
      await post([["5100", 2_000_400n, 0n], ["1110", 0n, 2_000_400n]]);
    });
    const mine = standardFormat();
    mine.unit = "RIBUAN";
    mine.labaRugi = mine.labaRugi.map((l) => (l.key === "laba_bersih" ? { ...l, label: "Laba bersih tahun berjalan", caps: true } : l));
    await db.reportFormat.create({ data: { firmId: g.firm.id, clientId: g.client.id, format: mine } });

    const buf = await financialStatementsPdf(db, { clientId: g.client.id, entityIds: [g.pt.entity.id] }, 2026, 3, { firm: "KJA Uji", title: "PT Uji Coba", draft: "bulan belum ditutup." });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const all = text.join("\n");
    for (const s of ["Laporan Posisi Keuangan", "Laporan Laba Rugi", "Catatan atas Laporan Keuangan", "Dinyatakan dalam ribuan Rupiah", "LABA BERSIH TAHUN BERJALAN", "Total aset", "Per 31 Mar 2026"]) expect(all, s).toContain(s);
    // Every page: the entity, the DRAF line and its number.
    text.forEach((page, i) => {
      expect(page).toContain("PT Uji Coba");
      expect(page).toContain("DRAF — bulan belum ditutup.");
      expect(page).toContain(`Halaman ${i + 1} dari ${totalPages}`);
    });
    // In thousands each line rounds and the total adds the printed lines: 5.001 − 2.000 = 3.001 (the exact 3.000.200 would print 3.000).
    expect(all).toMatch(/LABA BERSIH TAHUN BERJALAN\s+3\.001/);
    // The CALK's manual parts travel with the PDF, as blanks to fill.
    expect(all).toContain("PERISTIWA SETELAH PERIODE PELAPORAN");
    expect(all).toContain("Alamat: [isi oleh manajemen:");
    // Accounts beneath a Pos stay in the Excel file (the CALK lists them).
    expect(text.find((p) => p.includes("Laporan Laba Rugi"))).not.toContain("4100 ");
  });

  it("a total adds the printed lines it names", () => {
    const rows = [
      { label: "a", values: [1_499n], key: "a" },
      { label: "b", values: [1_499n], key: "b" },
      { label: "t", values: [2_998n], key: "t", terms: [{ key: "a", sign: 1 as const }, { key: "b", sign: 1 as const }] },
    ];
    expect(printedValues(rows, "RIBUAN")).toEqual([[1n], [1n], [2n]]);
    expect(printedValues(rows, "RUPIAH")).toEqual([[1_499n], [1_499n], [2_998n]]);
  });

  it("keeps the standard fonts' WinAnsi: signs get their ASCII spelling, Rupiah text stays", () => {
    expect(winAnsi("Diskonto −1% · ≤ 12 bulan → “final” – Rp 1.000 é")).toBe("Diskonto -1% · <= 12 bulan -> “final” – Rp 1.000 é");
    expect(winAnsi("日本")).toBe("??");
  });
});
