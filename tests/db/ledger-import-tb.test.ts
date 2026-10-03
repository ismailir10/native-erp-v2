import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { db, makeGroup, resetDb } from "../helpers";
import { detectTables, readSheets, readTable } from "@/lib/ledger-import/read";
import { importSourceAccounts, postImport, stageImport } from "@/lib/ledger-import/post";
import { acceptMappings } from "@/lib/ledger-import/mapping";
import { trialBalance } from "@/lib/reports/ledger";
import { dateOnly } from "@/lib/format";

/**
 * UC-K2: a trial balance with last year's Dr/Cr, Adjustment, the adjusted balance, the movement and the closing balance, under headers
 * with typos. Known numbers (Rupiah):
 *   account        opening   adj    adjusted  movement  closing
 *   1-100 Kas        1000     0       1000      +500      1500
 *   1-200 Piutang     400   -100       300      +200       500
 *   2-100 Utang      -300     0       -300      -100      -400
 *   3-100 Modal     -1000     0      -1000         0     -1000
 *   3-200 Laba Dit.  -100   +100         0         0         0
 *   4-100 Penjualan     0     0          0      -900      -900
 *   6-100 Beban         0     0          0      +300       300
 */
type Account = [code: string, name: string, opening: number, adjustment: number, adjusted: number, movement: number, closing: number];
const ACCOUNTS: Account[] = [
  ["1-100", "Kas", 1000, 0, 1000, 500, 1500],
  ["1-200", "Piutang Usaha", 400, -100, 300, 200, 500],
  ["2-100", "Utang Usaha", -300, 0, -300, -100, -400],
  ["3-100", "Modal Disetor", -1000, 0, -1000, 0, -1000],
  ["3-200", "Laba Ditahan", -100, 100, 0, 0, 0],
  ["4-100", "Penjualan", 0, 0, 0, -900, -900],
  ["6-100", "Beban Umum", 0, 0, 0, 300, 300],
];
const drcr = (n: number) => [n > 0 ? n : 0, n < 0 ? -n : 0];
const sum = (i: 2 | 3 | 4 | 5 | 6, side: 0 | 1) => ACCOUNTS.reduce((s, a) => s + drcr(a[i])[side], 0);

/** Two header rows (group labels, then Dr/Cr), typos in the title and a label, a Total row. */
async function twoRowTb() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("TB");
  ws.addRow(["PT CONTOH"]);
  ws.addRow(["TRIAL BALANCI"]);
  ws.addRow(["Periode 1 Januari 2026 s.d. 30 Juni 2026"]);
  ws.addRow(["COA", "Nama Akun", "Saldo Awal", null, "Adjusment", null, "Saldo Setelah Penyesuaian", null, "Mutasi", null, "Saldo Akhir", null]);
  ws.addRow([null, null, "Dr", "Cr", "Dr", "Cr", "Dr", "Cr", "Dr", "Cr", "Dr", "Cr"]);
  for (const [code, name, ...v] of ACCOUNTS) ws.addRow([code, name, ...v.flatMap(drcr)]);
  ws.addRow(["Total", null, ...([2, 3, 4, 5, 6] as const).flatMap((i) => [sum(i, 0), sum(i, 1)])]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("trial balance reader (UC-K2)", () => {
  it("reads a two-row TB with a typo in a group label as five column groups, and says so", async () => {
    const sheets = await readSheets("tb.xlsx", await twoRowTb());
    const [t] = detectTables(sheets);
    expect(t).toMatchObject({ mode: "NERACA", headerRow: 4, columns: { code: 0, name: 1 } });
    expect(t.tb?.groups).toEqual({ OPENING: { debit: 2, credit: 3 }, ADJUSTMENT: { debit: 4, credit: 5 }, ADJUSTED: { debit: 6, credit: 7 }, MOVEMENT: { debit: 8, credit: 9 }, CLOSING: { debit: 10, credit: 11 } });
    expect(t.typos?.map((x) => [x.header, x.label])).toEqual([["Adjusment", "Adjustment"]]);
    const res = readTable(sheets, t);
    if (res.mode !== "NERACA" || !res.tb) throw new Error("not a TB");
    expect(res.date).toEqual(dateOnly(2026, 6, 30));
    expect(res.tb.opening).toEqual(dateOnly(2025, 12, 31));
    expect(res.tb.rows.find((r) => r.code === "1-200")).toMatchObject({ ref: "TB!7", values: { OPENING: 40000n, ADJUSTMENT: -10000n, ADJUSTED: 30000n, MOVEMENT: 20000n, CLOSING: 50000n } });
    expect(res.tb.totals).toHaveLength(1);
  });

  it("reads one header row naming group and side, and a signed column per group", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("NS");
    ws.addRow(["Kode Akun", "Nama Akun", "Saldo Awal Debit", "Saldo Awal Kredit", "Saldo Akhir Debit", "Saldo Akhri Kredit"]);
    ws.addRow(["1-100", "Kas", 100, 0, 150, 0]);
    ws.addRow(["4-100", "Penjualan", 0, 100, 0, 150]);
    const signed = wb.addWorksheet("Signed");
    signed.addRow(["Kode Akun", "Nama Akun", "Saldo 31/12/2025", "Mutasi", "Saldo 30/06/2026"]);
    signed.addRow(["1-100", "Kas", 100, 50, 150]);
    const sheets = await readSheets("tb.xlsx", Buffer.from(await wb.xlsx.writeBuffer()));
    const [ns, sg] = detectTables(sheets);
    expect(ns.tb?.groups).toEqual({ OPENING: { debit: 2, credit: 3 }, CLOSING: { debit: 4, credit: 5 } });
    // Balances named by their date: the earlier is the opening, the later the closing, and the dates are the TB's.
    expect(sg.tb).toEqual({ groups: { OPENING: { balance: 2 }, MOVEMENT: { balance: 3 }, CLOSING: { balance: 4 } }, dates: { OPENING: dateOnly(2025, 12, 31), CLOSING: dateOnly(2026, 6, 30) } });
  });
});

describe("trial balance import (UC-K2)", () => {
  beforeEach(resetDb);

  it("posts the opening, the Adjustment as its own journal, and the movement; the TB report equals each column", async () => {
    const g = await makeGroup();
    const st = await stageImport(db, { firmId: g.firm.id, clientId: g.client.id, fileName: "tb.xlsx", data: await twoRowTb(), entityId: g.pt.entity.id });
    if (st.status !== "STAGED") throw new Error("not staged");
    expect(st.mode).toBe("NERACA");
    const checks = await db.importCheck.findMany({ where: { ledgerImportId: st.importId } });
    expect(checks.filter((c) => c.severity === "BLOCK")).toEqual([]);
    expect(checks.map((c) => c.code)).toEqual(expect.arrayContaining(["TOTAL_OK", "HEADER_TYPO", "STATS"]));
    expect(checks.map((c) => c.code)).not.toContain("TB_ROW_MISMATCH");

    const map: Record<string, string> = { "1-100": "1110", "1-200": "1130", "2-100": "2110", "3-100": "3100", "3-200": "3200", "4-100": "4100", "6-100": "6190" };
    const src = await importSourceAccounts(db, st.importId);
    await acceptMappings(db, g.client.id, src.map((s) => ({ sourceAccountId: s.id, accountCode: map[s.code], method: "MANUAL" as const })));
    await postImport(db, g.client.id, st.importId);

    const entries = await db.journalEntry.findMany({ where: { ledgerImportId: st.importId }, include: { lines: { include: { account: true } } }, orderBy: { kind: "asc" } });
    expect(entries.map((e) => [e.kind, e.date.toISOString().slice(0, 10)])).toEqual([["OPENING", "2025-12-31"], ["ADJUSTMENT", "2025-12-31"], ["IMPORTED", "2026-06-30"]]);
    const adj = entries.find((e) => e.kind === "ADJUSTMENT")!;
    expect(adj.lines.map((l) => [l.account.code, l.debit, l.credit, l.sourceRef]).sort()).toEqual([["1130", 0n, 100n, "TB!E7"], ["3200", 100n, 0n, "TB!E10"]]);

    const tb = async (d: Date) => (await trialBalance(db, { clientId: g.client.id, entityIds: [g.pt.entity.id] }, d)).filter((r) => r.net !== 0n).map((r) => [r.account.code, Number(r.net)]);
    expect(await tb(dateOnly(2025, 12, 31))).toEqual([["1110", 1000], ["1130", 300], ["2110", -300], ["3100", -1000]]);
    expect(await tb(dateOnly(2026, 6, 30))).toEqual([["1110", 1500], ["1130", 500], ["2110", -400], ["3100", -1000], ["4100", -900], ["6190", 300]]);
  });

  it("names a row that doesn't tie across its columns and a Total that doesn't match", async () => {
    const g = await makeGroup();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("TB");
    ws.addRow(["Kode Akun", "Nama Akun", "Saldo Awal", "Mutasi", "Saldo Akhir"]);
    ws.addRow(["1-100", "Kas", 100, 50, 160]);
    ws.addRow(["3-100", "Modal", -100, -50, -150]);
    ws.addRow(["Jumlah", null, 0, 0, 99]);
    const st = await stageImport(db, { firmId: g.firm.id, clientId: g.client.id, fileName: "tb.xlsx", data: Buffer.from(await wb.xlsx.writeBuffer()), entityId: g.pt.entity.id, date: dateOnly(2026, 6, 30) });
    if (st.status !== "STAGED") throw new Error("not staged");
    const checks = await db.importCheck.findMany({ where: { ledgerImportId: st.importId } });
    expect(checks.find((c) => c.code === "TB_ROW_MISMATCH")?.message).toBe("1 baris tidak cocok: saldo setelah penyesuaian + mutasi ≠ saldo akhir. Contoh TB!2 1-100 Kas: seharusnya Rp 150, di file Rp 160.");
    expect(checks.find((c) => c.code === "TOTAL_MISMATCH")?.message).toBe('"Jumlah" di file tidak sama dengan jumlah baris pada kolom Saldo akhir (file Rp 99, baris Rp 10).');
    expect(checks.find((c) => c.code === "TB_OPENING_DATE")?.message).toBe("Tanggal saldo awal tidak tertulis di file: dianggap 31 Des 2025 (akhir tahun sebelum 30 Jun 2026).");
  });
});
