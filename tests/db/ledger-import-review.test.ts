import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { db, makeGroup, resetDb } from "../helpers";
import { detectTables, readSheets, readTable } from "@/lib/ledger-import/read";
import { planLedger, planNeraca } from "@/lib/ledger-import/check";
import { importSourceAccounts, postImport, stageImport } from "@/lib/ledger-import/post";
import { acceptMappings } from "@/lib/ledger-import/mapping";
import { importStatement } from "@/lib/import/pipeline";
import { loadReversible, reversalBlocker } from "@/lib/ledger/reverse";
import { removeLedgerImport } from "@/lib/imports/remove";
import { trialBalance, incomeStatement } from "@/lib/reports/ledger";
import { dateOnly } from "@/lib/format";
import type { LedgerRow } from "@/lib/ledger-import/types";

/** The review pass of cycle 4: each case failed (or was missing) before its fix. */
type G = Awaited<ReturnType<typeof makeGroup>>;
const MAP: Record<string, string> = { "1-100": "1110", "1-200": "1130", "2-100": "2110", "3-100": "3100", "3-200": "3200", "4-100": "4100", "6-100": "6190", "10-100": "1110", "40-100": "4100" };

async function xlsx(rows: unknown[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("S");
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
async function stage(g: G, rows: unknown[][], opts: { date?: Date; allowedPeriod?: { start: string; end: string } } = {}) {
  const st = await stageImport(db, { firmId: g.firm.id, clientId: g.client.id, fileName: `f-${randomUUID()}.xlsx`, data: await xlsx(rows), entityId: g.pt.entity.id, ...opts });
  if (st.status !== "STAGED") throw new Error("not staged");
  const src = await importSourceAccounts(db, st.importId);
  await acceptMappings(db, g.client.id, src.filter((s) => !s.accountId).map((s) => ({ sourceAccountId: s.id, accountCode: MAP[s.code], method: "MANUAL" as const })));
  const checks = await db.importCheck.findMany({ where: { ledgerImportId: st.importId } });
  return { id: st.importId, checks, codes: checks.map((c) => c.code) };
}
const tb = async (g: G, d: Date) => (await trialBalance(db, { clientId: g.client.id, entityIds: [g.pt.entity.id] }, d)).filter((r) => r.net !== 0n).map((r) => [r.account.code, Number(r.net)]);

/** A textbook worksheet per 31 Dec 2026: unadjusted, adjusting entries, adjusted. */
const WORKSHEET = [
  ["Neraca Lajur per 31 Desember 2026"],
  ["Kode Akun", "Nama Akun", "Neraca Saldo Sebelum Penyesuaian", null, "Jurnal Penyesuaian", null, "Neraca Saldo Setelah Penyesuaian", null],
  [null, null, "Debit", "Kredit", "Debit", "Kredit", "Debit", "Kredit"],
  ["1-100", "Kas", 1000, 0, 0, 0, 1000, 0],
  ["1-200", "Piutang Usaha", 300, 0, 0, 50, 250, 0],
  ["3-100", "Modal Disetor", 0, 700, 0, 0, 0, 700],
  ["4-100", "Penjualan", 0, 900, 0, 0, 0, 900],
  ["6-100", "Beban Umum", 300, 0, 50, 0, 350, 0],
];

describe("cycle 4 review: trial balances", () => {
  beforeEach(resetDb);

  it("H1: a Sebelum/Jurnal/Setelah Penyesuaian worksheet posts at its own date, the adjustments as their own journal", async () => {
    const sheets = await readSheets("w.xlsx", await xlsx(WORKSHEET));
    expect(detectTables(sheets)[0].tb?.groups).toEqual({ UNADJUSTED: { debit: 2, credit: 3 }, ADJUSTMENT: { debit: 4, credit: 5 }, ADJUSTED: { debit: 6, credit: 7 } });
    const g = await makeGroup();
    const f = await stage(g, WORKSHEET);
    expect(f.codes).not.toContain("TB_OPENING_DATE");
    await postImport(db, g.client.id, f.id);
    const entries = await db.journalEntry.findMany({ where: { ledgerImportId: f.id }, orderBy: { kind: "asc" } });
    expect(entries.map((e) => [e.kind, e.date.toISOString().slice(0, 10)])).toEqual([["OPENING", "2026-12-31"], ["ADJUSTMENT", "2026-12-31"]]);
    expect(await tb(g, dateOnly(2026, 12, 31))).toEqual([["1110", 1000], ["1130", 250], ["3100", -700], ["4100", -900], ["6190", 350]]);
    expect(Number((await incomeStatement(db, { clientId: g.client.id, entityIds: [g.pt.entity.id] }, dateOnly(2026, 1, 1), dateOnly(2026, 12, 31))).totals.netProfit)).toBe(550);
  });

  it("M4: without an Adjustment column, the adjustment implied by the adjusted balance is posted, so the books equal the closing column", async () => {
    const g = await makeGroup();
    const f = await stage(g, [
      ["Kode Akun", "Nama Akun", "Saldo Awal", "Setelah Penyesuaian", "Mutasi", "Saldo Akhir"],
      ["1-100", "Kas", 100, 100, 50, 150],
      ["1-200", "Piutang Usaha", 100, 80, 0, 80],
      ["3-100", "Modal Disetor", -200, -180, -50, -230],
    ], { date: dateOnly(2026, 6, 30) });
    expect(f.checks.find((c) => c.message.startsWith("Kolom Adjustment tidak ada"))?.severity).toBe("INFO");
    await postImport(db, g.client.id, f.id);
    expect(await tb(g, dateOnly(2026, 6, 30))).toEqual([["1110", 150], ["1130", 80], ["3100", -230]]);
    expect(await db.journalEntry.count({ where: { ledgerImportId: f.id, kind: "ADJUSTMENT" } })).toBe(1);
  });

  it("M1: a presentation-signed 'Saldo Awal | Debit | Kredit | Saldo Akhir' with sections reads balanced, the Debit/Kredit pair as movement", async () => {
    const g = await makeGroup();
    const f = await stage(g, [
      ["Kode Akun", "Nama Akun", "Saldo Awal", "Debit", "Kredit", "Saldo Akhir"],
      ["Aset"],
      ["1-100", "Kas", 1000, 300, 0, 1300],
      ["Liabilitas"],
      ["2-100", "Utang Usaha", 300, 0, 100, 400],
      ["Ekuitas"],
      ["3-100", "Modal Disetor", 700, 0, 200, 900],
    ], { date: dateOnly(2026, 6, 30) });
    expect(f.checks.filter((c) => c.severity === "BLOCK")).toEqual([]);
    expect(f.codes).toEqual(expect.arrayContaining(["TB_PRESENTATION_SIGN"]));
    expect(f.codes).not.toContain("SIGN_AGAINST_TYPE");
    expect(f.codes).not.toContain("TB_ROW_MISMATCH");
    await postImport(db, g.client.id, f.id);
    expect(await tb(g, dateOnly(2026, 6, 30))).toEqual([["1110", 1300], ["2110", -400], ["3100", -900]]);
  });

  it("M2: a print date in the title is never the closing date", async () => {
    const sheets = await readSheets("t.xlsx", await xlsx([
      ["Neraca Saldo per 30 Juni 2026"],
      ["Dicetak: 15/07/2026 10:30"],
      ["Kode Akun", "Nama Akun", "Saldo Awal", "Saldo Akhir"],
      ["1-100", "Kas", 100, 150],
    ]));
    const read = readTable(sheets, detectTables(sheets)[0]);
    if (read.mode !== "NERACA" || !read.tb) throw new Error("not a TB");
    expect([read.date, read.tb.opening]).toEqual([dateOnly(2026, 6, 30), null]);
  });

  it("M3: a TB staged from Dokumen fits the window of its closing date", async () => {
    const g = await makeGroup();
    const f = await stage(g, [["Kode Akun", "Nama Akun", "Saldo Awal", "Saldo Akhir"], ["1-100", "Kas", 100, 150], ["3-100", "Modal Disetor", -100, -150]], { date: dateOnly(2026, 6, 30), allowedPeriod: { start: "2026-06-30", end: "2026-06-30" } });
    expect(f.codes).toContain("STATS");
  });

  it("M6: a TB's Adjustment journal can't be reversed by hand", async () => {
    const g = await makeGroup();
    const f = await stage(g, WORKSHEET);
    await postImport(db, g.client.id, f.id);
    const adj = await db.journalEntry.findFirstOrThrow({ where: { ledgerImportId: f.id, kind: "ADJUSTMENT" } });
    expect(reversalBlocker((await loadReversible(db, adj.id))!)).toMatch(/^Jurnal dari impor file/);
  });

  it("H2: a GL or a bank statement inside a TB's period is refused, not counted twice", async () => {
    const g = await makeGroup();
    const f = await stage(g, [["Kode Akun", "Nama Akun", "Saldo Awal", "Saldo Akhir"], ["1-100", "Kas", 100, 150], ["3-100", "Modal Disetor", -100, -150]], { date: dateOnly(2026, 6, 30) });
    await postImport(db, g.client.id, f.id);
    const gl = await stage(g, [["Tanggal", "Kode Akun", "Nama Akun", "Debit", "Kredit"], ["15/03/2026", "10-100", "Kas", 10, 0], ["15/03/2026", "40-100", "Penjualan", 0, 10]]);
    expect(gl.checks.find((c) => c.code === "TB_COVERS")).toMatchObject({ severity: "BLOCK", message: expect.stringContaining("Impor buku besar mulai 1 Jul 2026") });
    const statement = Buffer.from(["Tanggal;Keterangan;Debet;Kredit;Saldo", "01/03/2026;SALDO AWAL;;;100.000,00", "05/03/2026;SETORAN TUNAI;0,00;10.000,00;110.000,00", ""].join("\n"));
    await expect(importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca.csv", data: statement, provider: null })).rejects.toThrow(/sudah dicatat dari neraca saldo/);
  });
});

describe("cycle 4 review: guards and noise", () => {
  beforeEach(resetDb);

  it("L1: a closed month is said on the draft", async () => {
    const g = await makeGroup();
    await db.period.upsert({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month: 3 } }, create: { firmId: g.firm.id, clientId: g.client.id, year: 2026, month: 3, status: "LOCKED" }, update: { status: "LOCKED" } });
    const gl = await stage(g, [["Tanggal", "Kode Akun", "Nama Akun", "Debit", "Kredit"], ["15/03/2026", "10-100", "Kas", 10, 0], ["15/03/2026", "40-100", "Penjualan", 0, 10]]);
    expect(gl.checks.find((c) => c.code === "PERIOD_LOCKED")?.message).toMatch(/^Bulan Maret 2026 sudah ditutup: 1 jurnal/);
  });

  it("M5 + L2: a Neraca with sen bridges; the GL under a bridge can't be removed before it", async () => {
    const g = await makeGroup();
    const gl = await stage(g, [["Tanggal", "Kode Akun", "Nama Akun", "Debit", "Kredit"], ["15/02/2023", "10-100", "Kas", 100, 0], ["15/02/2023", "40-100", "Penjualan", 0, 100]]);
    await postImport(db, g.client.id, gl.id);
    const anchor = await stage(g, [["Kode Akun", "Nama Akun", "Saldo"], ["Aset"], ["1-100", "Kas", 1100.4], ["Ekuitas"], ["3-100", "Modal Disetor", 1000.4], ["3-200", "Saldo Laba", 100]], { date: dateOnly(2023, 12, 31) });
    await postImport(db, g.client.id, anchor.id);
    expect(await tb(g, dateOnly(2023, 12, 31))).toEqual([["1110", 1100], ["3100", -1000], ["3200", 0], ["4100", -100]].filter(([, n]) => n !== 0));
    const admin = await db.firmMember.create({ data: { firmId: g.firm.id, userId: randomUUID(), email: `a-${randomUUID()}@example.test`, name: "Admin", role: "ADMIN" } });
    await expect(removeLedgerImport(db, { clientId: g.client.id, importId: gl.id, reason: "GL versi lama, diganti", actor: { id: admin.id, role: "ADMIN" } })).rejects.toThrow(/dibangun dari Neraca .* per 31 Des 2023/);
  });

  it("L3 + L5: no missing months between yearly comparatives; a far month of the same year is not a year typo", async () => {
    const sheets = await readSheets("c.xlsx", await xlsx([["Kode Akun", "Nama Akun", "31/12/2025", "31/12/2024"], ["Aset"], ["1-100", "Kas", 100, 90], ["Ekuitas"], ["3-100", "Modal", 100, 90]]));
    const t = detectTables(sheets)[0];
    const read = readTable(sheets, t);
    if (read.mode !== "NERACA") throw new Error("mode");
    const multi = planNeraca(read.rows, read.totals, { entityKey: "", entity: { entityId: "e", name: "PT", currency: "IDR" }, date: read.date!, sheet: "S", periods: t.periods, column: t.columns.amount }).checks.find((c) => c.code === "MULTI_PERIOD")!;
    expect(multi.message).not.toContain("tidak ada di file");

    let n = 0;
    const row = (m: number): LedgerRow => ({ ref: `GL!${++n}`, row: n, date: dateOnly(2026, m, 10), entity: null, code: "1101", name: "Kas", debit: 1n, credit: 0n, currency: null, rate: null, description: "", voucher: null, errors: [] });
    const rows = [...Array.from({ length: 20 }, () => row(1)), row(9), row(9)];
    const p = planLedger(rows, { entities: new Map([["", { entityId: "e", name: "PT", currency: "IDR" }]]), currencyMode: "FUNCTIONAL" });
    expect(p.checks.map((c) => c.code)).not.toContain("DATE_OUTLIER");
  });

  it("L6: a typo in a TB's account header is reported too", async () => {
    const sheets = await readSheets("t.xlsx", await xlsx([["Kode Akun", "Nama Akunn", "Saldo Awal", "Saldo Akhir"], ["1-100", "Kas", 100, 150]]));
    const t = detectTables(sheets)[0];
    expect(t.tb).toBeDefined();
    expect(t.typos?.map((x) => [x.header, x.label])).toEqual([["Nama Akunn", "Nama akun"]]);
  });
});
