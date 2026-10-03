import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { db, makeGroup, resetDb } from "../helpers";
import { importSourceAccounts, postImport, stageImport } from "@/lib/ledger-import/post";
import { acceptMappings } from "@/lib/ledger-import/mapping";
import { balanceSheet, incomeStatement, trialBalance } from "@/lib/reports/ledger";
import { dateOnly } from "@/lib/format";

/**
 * UC-K2 synthetic set: four files a client brings instead of statements, each with known final numbers (Rupiah), through the real
 * pipeline. Every trap the use case names must be caught on the draft.
 *
 * 1. GL, journal format, no Saldo Awal (PT), headers with typos ("Tangal", "Kredti"), a negative amount, a Total row, months without rows:
 *      15 Feb 2023 sale 100 cash · 10 Jun expense 30 cash · 20 Nov expense 20 on credit (written as debit −20 on Utang).
 * 2. Neraca per 31 Dec 2023 (PT), the anchor: Kas 1.070, Piutang 200 | Utang 120, Modal 1.000, Saldo Laba 150.
 *      → Saldo Awal per 14 Feb 2023 by the bridge; Neraca at 31 Dec 2023 = the file; Laba Rugi 2023 = 50.
 * 3. TB per 30 Jun 2026 (owner), "TRIAL BALANCI", "Adjusment":
 *      Kas 500 / 0 / 500 / +100 / 600 · Piutang 200 / −50 / 150 / 0 / 150 · Modal −700 · Saldo Laba 0 / +50 / 50 · Pendapatan 0 / … / −100.
 * 4. Neraca Jan–Jun 2026 without February (second client): Kas = Modal = 100, 110, 120, 130, 140.
 */
type G = Awaited<ReturnType<typeof makeGroup>>;
const MAP: Record<string, string> = { "10-100": "1110", "20-100": "2110", "40-100": "4100", "60-100": "6190", "1-100": "1110", "1-200": "1130", "2-100": "2110", "3-100": "3100", "3-200": "3200", "4-100": "4100" };

async function xlsx(rows: unknown[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("S");
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
async function stage(g: G, entityId: string, fileName: string, rows: unknown[][], date?: Date) {
  const st = await stageImport(db, { firmId: g.firm.id, clientId: g.client.id, fileName, data: await xlsx(rows), entityId, date });
  if (st.status !== "STAGED") throw new Error("not staged");
  const src = await importSourceAccounts(db, st.importId);
  await acceptMappings(db, g.client.id, src.filter((s) => !s.accountId).map((s) => ({ sourceAccountId: s.id, accountCode: MAP[s.code], method: "MANUAL" as const })));
  const checks = await db.importCheck.findMany({ where: { ledgerImportId: st.importId } });
  return { id: st.importId, codes: checks.map((c) => c.code), check: (code: string) => checks.find((c) => c.code === code) };
}
const tb = async (g: G, entityId: string, d: Date) => (await trialBalance(db, { clientId: g.client.id, entityIds: [entityId] }, d)).filter((r) => r.net !== 0n).map((r) => [r.account.code, Number(r.net)]);

describe("UC-K2: a client's existing files become books that tie to them", () => {
  beforeEach(resetDb);

  it("GL without Saldo Awal + a later Neraca + a TB with Adjustment + a Neraca missing February", async () => {
    const g = await makeGroup();
    const [pt, owner] = [g.pt.entity.id, g.owner.entity.id];

    // 1. GL
    const gl = await stage(g, pt, "gl.xlsx", [
      ["Tangal", "Kode Akun", "Nama Akun", "Debit", "Kredti"],
      ["15/02/2023", "10-100", "Kas", 100, 0],
      ["15/02/2023", "40-100", "Penjualan", 0, 100],
      ["10/06/2023", "60-100", "Beban Umum", 30, 0],
      ["10/06/2023", "10-100", "Kas", 0, 30],
      ["20/11/2023", "60-100", "Beban Umum", 20, 0],
      ["20/11/2023", "20-100", "Utang Usaha", -20, 0],
      ["Total", null, null, 130, 130],
    ]);
    expect(gl.codes.filter((c) => c === "HEADER_TYPO")).toHaveLength(2);
    expect(gl.check("NEGATIVE_AMOUNT")).toMatchObject({ severity: "REVIEW", refs: ["S!7"] });
    expect(gl.check("TOTAL_OK")?.message).toBe('"Total" di file cocok dengan jumlah baris: debit Rp 130, kredit Rp 130.');
    expect(gl.check("MISSING_MONTH")?.message).toMatch(/^PT Uji: tidak ada baris di Maret 2023, April 2023, Mei 2023, Juli 2023 dan 3 bulan lain/);
    expect(gl.check("NO_OPENING")).toMatchObject({ severity: "INFO" });
    await postImport(db, g.client.id, gl.id);

    // 2. Neraca anchor → opening bridge
    const anchor = await stage(g, pt, "neraca-2023.xlsx", [["Kode Akun", "Nama Akun", "Saldo"], ["Aset"], ["1-100", "Kas", 1070], ["1-200", "Piutang Usaha", 200], ["Liabilitas"], ["2-100", "Utang Usaha", 120], ["Ekuitas"], ["3-100", "Modal Disetor", 1000], ["3-200", "Saldo Laba", 150]], dateOnly(2023, 12, 31));
    expect(anchor.check("OPENING_BRIDGE")?.severity).toBe("REVIEW");
    await postImport(db, g.client.id, anchor.id);
    const scope = { clientId: g.client.id, entityIds: [pt] };
    const bs = await balanceSheet(db, scope, dateOnly(2023, 12, 31));
    expect([bs.totals.assets, bs.totals.liabilities, bs.totals.equity].map(Number)).toEqual([1270, 120, 1150]);
    expect(Number((await incomeStatement(db, scope, dateOnly(2023, 1, 1), dateOnly(2023, 12, 31))).totals.netProfit)).toBe(50);
    expect((await db.journalEntry.findFirstOrThrow({ where: { entityId: pt, kind: "OPENING" } })).date).toEqual(dateOnly(2023, 2, 14));

    // 3. TB with Adjustment (owner)
    const tbFile = await stage(g, owner, "tb.xlsx", [
      ["TRIAL BALANCI"],
      ["Periode 1 Januari 2026 s.d. 30 Juni 2026"],
      ["COA", "Nama Akun", "Saldo Awal", null, "Adjusment", null, "Saldo Setelah Penyesuaian", null, "Mutasi", null, "Saldo Akhir", null],
      [null, null, "Dr", "Cr", "Dr", "Cr", "Dr", "Cr", "Dr", "Cr", "Dr", "Cr"],
      ["1-100", "Kas", 500, 0, 0, 0, 500, 0, 100, 0, 600, 0],
      ["1-200", "Piutang Usaha", 200, 0, 0, 50, 150, 0, 0, 0, 150, 0],
      ["3-100", "Modal Disetor", 0, 700, 0, 0, 0, 700, 0, 0, 0, 700],
      ["3-200", "Saldo Laba", 0, 0, 50, 0, 50, 0, 0, 0, 50, 0],
      ["4-100", "Pendapatan", 0, 0, 0, 0, 0, 0, 0, 100, 0, 100],
      ["Total", null, 700, 700, 50, 50, 700, 700, 100, 100, 800, 800],
    ]);
    expect(tbFile.codes).toEqual(expect.arrayContaining(["HEADER_TYPO", "TOTAL_OK"]));
    expect(tbFile.codes).not.toContain("TB_ROW_MISMATCH");
    await postImport(db, g.client.id, tbFile.id);
    expect(await tb(g, owner, dateOnly(2025, 12, 31))).toEqual([["1110", 500], ["1130", 150], ["3100", -700], ["3200", 50]]);
    expect(await tb(g, owner, dateOnly(2026, 6, 30))).toEqual([["1110", 600], ["1130", 150], ["3100", -700], ["3200", 50], ["4100", -100]]);
    expect(await db.journalEntry.count({ where: { ledgerImportId: tbFile.id, kind: "ADJUSTMENT" } })).toBe(1);

    // 4. Neraca Jan–Jun without February (another client)
    const h = await makeGroup();
    const series = await stage(h, h.pt.entity.id, "neraca-2026.xlsx", [
      ["Kode Akun", "Nama Akun", "Jan 2026", "Mar 2026", "Apr 2026", "Mei 2026", "Jun 2026"],
      ["Aset"],
      ["1-100", "Kas", 100, 110, 120, 130, 140],
      ["Ekuitas"],
      ["3-100", "Modal Disetor", 100, 110, 120, 130, 140],
    ]);
    expect(series.check("MULTI_PERIOD")?.message).toContain("Kolom Februari 2026 tidak ada di file.");
    await postImport(db, h.client.id, series.id);
    expect(await tb(h, h.pt.entity.id, dateOnly(2026, 1, 31))).toEqual([["1110", 100], ["3100", -100]]);
  }, 60_000);
});
