import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { db, makeGroup, resetDb } from "../helpers";
import { importSourceAccounts, postImport, stageImport } from "@/lib/ledger-import/post";
import { acceptMappings } from "@/lib/ledger-import/mapping";
import { balanceSheet, incomeStatement, trialBalance } from "@/lib/reports/ledger";
import { postJournal } from "@/lib/ledger/post";
import { dateOnly } from "@/lib/format";

/**
 * UC-K2 / UC-B4: a GL that starts in February 2023 with no Saldo Awal, and a Neraca per 31 Dec 2023 as the anchor. Known numbers (Rupiah):
 *   GL:     15 Feb sale 100 cash · 10 Jun expense 30 cash · 20 Nov expense 20 on credit → Kas +70, Utang −20, profit 50.
 *   Anchor: Kas 1.070, Piutang 200 | Utang 120, Modal 1.000, Saldo Laba (incl. this year) 150.
 *   Bridge per 14 Feb 2023: Kas 1.000, Piutang 200, Utang −100, Modal −1.000, Saldo Laba −100 (the year's 50 is in the GL).
 */
type G = Awaited<ReturnType<typeof makeGroup>>;
const MAP: Record<string, string> = { "10-100": "1110", "20-100": "2110", "40-100": "4100", "60-100": "6190", "1-100": "1110", "1-200": "1130", "2-100": "2110", "3-100": "3100", "3-200": "3200" };

async function xlsx(rows: unknown[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("S");
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const GL = [
  ["Tanggal", "Kode Akun", "Nama Akun", "Debit", "Kredit"],
  ["15/02/2023", "10-100", "Kas", 100, 0],
  ["15/02/2023", "40-100", "Penjualan", 0, 100],
  ["10/06/2023", "60-100", "Beban Umum", 30, 0],
  ["10/06/2023", "10-100", "Kas", 0, 30],
  ["20/11/2023", "60-100", "Beban Umum", 20, 0],
  ["20/11/2023", "20-100", "Utang Usaha", 0, 20],
];
const ANCHOR = (earnings = "3-200") => [
  ["Kode Akun", "Nama Akun", "Saldo"],
  ["Aset"],
  ["1-100", "Kas", 1070],
  ["1-200", "Piutang Usaha", 200],
  ["Liabilitas"],
  ["2-100", "Utang Usaha", 120],
  ["Ekuitas"],
  ["3-100", "Modal Disetor", 1000],
  [earnings, "Saldo Laba", 150],
];

async function importFile(g: G, rows: unknown[][], opts: { date?: Date; map?: Record<string, string> } = {}) {
  const st = await stageImport(db, { firmId: g.firm.id, clientId: g.client.id, fileName: `f${Math.random()}.xlsx`, data: await xlsx(rows), entityId: g.pt.entity.id, date: opts.date });
  if (st.status !== "STAGED") throw new Error("not staged");
  const src = await importSourceAccounts(db, st.importId);
  const map = { ...MAP, ...opts.map };
  await acceptMappings(db, g.client.id, src.filter((s) => !s.accountId).map((s) => ({ sourceAccountId: s.id, accountCode: map[s.code], method: "MANUAL" as const })));
  return st.importId;
}

describe("opening bridge (UC-K2, UC-B4)", () => {
  beforeEach(resetDb);

  it("builds Saldo Awal the day before the first journal so the Neraca at the anchor date equals the file", async () => {
    const g = await makeGroup();
    await postImport(db, g.client.id, await importFile(g, GL));
    const anchorId = await importFile(g, ANCHOR(), { date: dateOnly(2023, 12, 31) });
    const bridge = (await db.importCheck.findMany({ where: { ledgerImportId: anchorId, code: "OPENING_BRIDGE" } }))[0];
    expect(bridge.severity).toBe("REVIEW");
    expect(bridge.message).toContain("dibangun per 14 Feb 2023");
    await postImport(db, g.client.id, anchorId);

    const opening = await db.journalEntry.findFirstOrThrow({ where: { entityId: g.pt.entity.id, kind: "OPENING" }, include: { lines: { include: { account: true } } } });
    expect(opening.date).toEqual(dateOnly(2023, 2, 14));
    const net = new Map<string, number>();
    for (const l of opening.lines) net.set(l.account.code, (net.get(l.account.code) ?? 0) + Number(l.debit - l.credit));
    expect(Object.fromEntries(net)).toEqual({ "1110": 1000, "1130": 200, "2110": -100, "3100": -1000, "3200": -100 });
    // The bridging lines are visible as such, beside the anchor's own cells.
    expect(opening.lines.filter((l) => l.memo?.includes("opening bridge")).map((l) => [l.account.code, Number(l.debit - l.credit)]).sort()).toEqual([["1110", -70], ["2110", 20], ["3200", 50]]);

    const scope = { clientId: g.client.id, entityIds: [g.pt.entity.id] };
    const tb = (await trialBalance(db, scope, dateOnly(2023, 12, 31))).filter((r) => r.net !== 0n).map((r) => [r.account.code, Number(r.net)]);
    expect(tb).toEqual([["1110", 1070], ["1130", 200], ["2110", -120], ["3100", -1000], ["3200", -100], ["4100", -100], ["6190", 50]]);
    const bs = await balanceSheet(db, scope, dateOnly(2023, 12, 31));
    expect([bs.totals.assets, bs.totals.liabilities, bs.totals.equity].map(Number)).toEqual([1270, 120, 1150]);
    expect(Number((await incomeStatement(db, scope, dateOnly(2023, 1, 1), dateOnly(2023, 12, 31))).totals.netProfit)).toBe(50);
  });

  it("refuses a bridge while the books hold money on 1999, and an anchor line mapped to income or expense", async () => {
    const g = await makeGroup();
    await postImport(db, g.client.id, await importFile(g, GL));
    const acc = async (code: string) => (await db.account.findUniqueOrThrow({ where: { clientId_code: { clientId: g.client.id, code } } })).id;
    await db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2023, 7, 1), kind: "ADJUSTMENT", memo: "uji", lines: [{ accountId: await acc("1999"), debit: 5n }, { accountId: await acc("1110"), credit: 5n }] }));
    const first = await importFile(g, ANCHOR(), { date: dateOnly(2023, 12, 31) });
    await expect(postImport(db, g.client.id, first)).rejects.toThrow(/1999 Belum Terklasifikasi masih Rp 5 per 31 Des 2023/);
    await db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2023, 7, 2), kind: "ADJUSTMENT", memo: "uji balik", lines: [{ accountId: await acc("1999"), credit: 5n }, { accountId: await acc("1110"), debit: 5n }] }));
    await db.ledgerImport.delete({ where: { id: first } });

    // A Neraca line mapped to income (a new source code, so the mapping is this file's own).
    const second = await importFile(g, ANCHOR("3-299"), { date: dateOnly(2023, 12, 31), map: { "3-299": "4100" } });
    await expect(postImport(db, g.client.id, second)).rejects.toThrow(/dipetakan ke akun laba rugi 4100 Penjualan/);
  });

  it("refuses a trial balance over months that already have journals", async () => {
    const g = await makeGroup();
    await postImport(db, g.client.id, await importFile(g, GL));
    const st = await stageImport(db, { firmId: g.firm.id, clientId: g.client.id, fileName: "tb.xlsx", data: await xlsx([["Kode Akun", "Nama Akun", "Saldo Awal", "Saldo Akhir"], ["1-100", "Kas", 0, 100], ["3-100", "Modal", 0, -100]]), entityId: g.pt.entity.id, date: dateOnly(2023, 12, 31) });
    if (st.status !== "STAGED") throw new Error("not staged");
    const block = (await db.importCheck.findMany({ where: { ledgerImportId: st.importId, code: "TB_OVERLAP" } }))[0];
    expect(block).toMatchObject({ severity: "BLOCK" });
    expect(block.message).toContain("sudah punya jurnal sejak 15 Feb 2023");
  });
});
