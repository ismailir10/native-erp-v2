import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { db, makeGroup, resetDb } from "../helpers";
import { acceptCheck, importSourceAccounts, LedgerImportError, postImport, stageImport } from "@/lib/ledger-import/post";
import { acceptMappings, suggestMappings } from "@/lib/ledger-import/mapping";
import { upsertRate } from "@/lib/fx/rates";
import { dateOnly } from "@/lib/format";

async function xlsx(rows: unknown[][], sheet = "GL"): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const H = ["Entity", "Entry Date", "Account Code", "Account Name", "Currency", "Debit", "Credit", "Notes"];
const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));

async function mapAllBySuggestion(clientId: string, importId: string) {
  const g = await db.client.findUniqueOrThrow({ where: { id: clientId } });
  await suggestMappings(db, { firmId: g.firmId, clientId, provider: null, useAi: false });
  const src = await importSourceAccounts(db, importId);
  await acceptMappings(
    db,
    clientId,
    src.map((s) => (s.suggestedCode ? { sourceAccountId: s.id, accountCode: s.suggestedCode, method: s.suggestedBy! } : { sourceAccountId: s.id, accountCode: "6190", method: "MANUAL" as const })),
  );
}

describe("ledger import: stage → map → post", () => {
  beforeEach(resetDb);

  it("posts a multi-entity ledger with row refs, source accounts, a 7190 rounding line and an accepted 1999 difference", async () => {
    const g = await makeGroup();
    const file = await xlsx([
      ["GL MASTER"],
      H,
      ["PT Uji", d(2026, 1, 31), "10000", "Petty Cash", "IDR", 1000.5, 0, ""],
      ["PT Uji", d(2026, 1, 31), "10001", "Kas Operasional", "IDR", 1000.5, 0, ""],
      ["PT Uji", d(2026, 1, 31), "31001", "Modal Saham", "IDR", 0, 2001, ""],
      ["Andi", d(2026, 2, 28), "60001", "Beban Gaji", "IDR", 5_000_000, 0, ""],
      ["Andi", d(2026, 2, 28), "10000", "Kas", "IDR", 0, 4_000_000, ""],
    ]);
    const staged = await stageImport(db, { firmId: g.firm.id, clientId: g.client.id, fileName: "gl.xlsx", data: file });
    if (staged.status !== "STAGED") throw new Error("not staged");
    expect(staged).toMatchObject({ mode: "LEDGER", entries: 2, sourceAccounts: 5, unmapped: 5 });
    const unbalanced = staged.checks.find((c) => c.code === "UNBALANCED")!;
    expect(unbalanced.message).toMatch(/Andi 28 Feb 2026 tidak seimbang: selisih Rp 1.000.000/);

    // Nothing posts before mapping, nor before the BLOCK is accepted.
    await expect(postImport(db, g.client.id, staged.importId)).rejects.toThrow(/BLOCK/);
    const check = await db.importCheck.findFirstOrThrow({ where: { ledgerImportId: staged.importId, code: "UNBALANCED" } });
    await acceptCheck(db, g.client.id, check.id);
    await expect(postImport(db, g.client.id, staged.importId)).rejects.toThrow(/belum dipetakan/);
    await mapAllBySuggestion(g.client.id, staged.importId);

    const res = await postImport(db, g.client.id, staged.importId);
    expect(res.entries).toBe(2);
    const entries = await db.journalEntry.findMany({ where: { ledgerImportId: staged.importId }, include: { lines: { include: { account: true, sourceAccount: true } } }, orderBy: { date: "asc" } });
    expect(entries.map((e) => [e.kind, e.sourceRef])).toEqual([
      ["IMPORTED", "GL!3-5"],
      ["IMPORTED", "GL!6-7"],
    ]);
    const jan = entries[0].lines.map((l) => [l.account.code, l.sourceAccount?.code ?? null, l.debit, l.credit, l.sourceRef]);
    expect(jan).toEqual([
      ["1110", "10000", 1001n, 0n, "GL!3"],
      ["1110", "10001", 1001n, 0n, "GL!4"],
      ["3100", "31001", 0n, 2001n, "GL!5"],
      ["7190", null, 0n, 1n, null],
    ]);
    const feb = entries[1].lines.map((l) => [l.account.code, l.debit, l.credit, l.memo]);
    expect(feb).toContainEqual(["1999", 0n, 1_000_000n, "Selisih dari file sumber"]);
    expect((await db.ledgerImport.findUniqueOrThrow({ where: { id: staged.importId } })).status).toBe("POSTED");

    // Same sheet again → refused.
    await expect(stageImport(db, { firmId: g.firm.id, clientId: g.client.id, fileName: "gl.xlsx", data: file })).rejects.toThrow(LedgerImportError);
  });

  it("an all-zero group is reported but not staged, so 'Catat N jurnal' equals what posts", async () => {
    const g = await makeGroup();
    const file = await xlsx([
      H,
      ["PT Uji", d(2026, 1, 31), "10000", "Petty Cash", "IDR", 1000, 0, ""],
      ["PT Uji", d(2026, 1, 31), "31001", "Modal Saham", "IDR", 0, 1000, ""],
      ["PT Uji", d(2026, 2, 28), "10000", "Petty Cash", "IDR", 0, 0, ""],
      ["PT Uji", d(2026, 2, 28), "31001", "Modal Saham", "IDR", 0, 0, ""],
    ]);
    const staged = await stageImport(db, { firmId: g.firm.id, clientId: g.client.id, fileName: "gl.xlsx", data: file });
    if (staged.status !== "STAGED") throw new Error("not staged");
    expect(staged.entries).toBe(1);
    expect(staged.checks.find((c) => c.code === "STATS")?.message).toMatch(/1 jurnal bernilai nol dilewati/);
    expect((await db.ledgerImport.findUniqueOrThrow({ where: { id: staged.importId } })).groupCount).toBe(1);
    await mapAllBySuggestion(g.client.id, staged.importId);
    expect((await postImport(db, g.client.id, staged.importId)).entries).toBe(1);
  });

  it("asks for the sheet when several tables match", async () => {
    const g = await makeGroup();
    const wb = new ExcelJS.Workbook();
    for (const name of ["A", "B"]) {
      const ws = wb.addWorksheet(name);
      ws.addRow(["Tanggal", "Kode Akun", "Nama Akun", "Debit", "Kredit"]);
      ws.addRow(["31/01/2026", "1", "Kas", 1, 0]);
    }
    const res = await stageImport(db, { firmId: g.firm.id, clientId: g.client.id, fileName: "x.xlsx", data: Buffer.from(await wb.xlsx.writeBuffer()), entityId: g.pt.entity.id });
    expect(res.status).toBe("CHOOSE_SHEET");
  });

  it("refuses to post into a locked period and leaves nothing behind", async () => {
    const g = await makeGroup();
    const file = await xlsx([H, ["PT Uji", d(2026, 1, 31), "1", "Kas", "IDR", 100, 0, ""], ["PT Uji", d(2026, 1, 31), "2", "Modal Saham", "IDR", 0, 100, ""]]);
    const staged = await stageImport(db, { firmId: g.firm.id, clientId: g.client.id, fileName: "gl.xlsx", data: file });
    if (staged.status !== "STAGED") throw new Error("not staged");
    await mapAllBySuggestion(g.client.id, staged.importId);
    await db.period.create({ data: { firmId: g.firm.id, clientId: g.client.id, year: 2026, month: 1, status: "LOCKED" } });
    await expect(postImport(db, g.client.id, staged.importId)).rejects.toThrow(/sudah ditutup/);
    expect(await db.journalEntry.count({ where: { ledgerImportId: staged.importId } })).toBe(0);
  });

  it("imports a Jurnal-style Neraca as the entity's opening entry, once", async () => {
    const g = await makeGroup();
    const file = await xlsx(
      [
        ["PT UJI"],
        ["Balance Sheet"],
        ["Date", "", "31/05/2026", ""],
        ["Assets"],
        ["1-1000", "BANK", 1500.4, ""],
        ["Total Assets", null, 1500.4, ""],
        ["Liability & Equity"],
        ["2-2000", "Accounts Payable", 500, ""],
        ["Equity"],
        ["3-3000", "Share Capital", 1200, ""],
        [null, "Current Period Earnings", -199.6, ""],
        ["Total Liability & Equity", null, 1500.4, ""],
      ],
      "31-05-2026",
    );
    const staged = await stageImport(db, { firmId: g.firm.id, clientId: g.client.id, fileName: "balance_sheet.xlsx", data: file, entityId: g.pt.entity.id });
    if (staged.status !== "STAGED") throw new Error("not staged");
    expect(staged.checks.filter((c) => c.code === "TOTAL_OK")).toHaveLength(2);
    await mapAllBySuggestion(g.client.id, staged.importId);
    await postImport(db, g.client.id, staged.importId);
    const opening = await db.journalEntry.findFirstOrThrow({ where: { entityId: g.pt.entity.id, kind: "OPENING" }, include: { lines: { include: { account: true } } } });
    expect(opening.date.toISOString().slice(0, 10)).toBe("2026-05-31");
    expect(opening.lines.map((l) => [l.account.code, l.debit - l.credit])).toEqual([
      ["1120", 1500n],
      ["2110", -500n],
      ["3100", -1200n],
      ["3200", 200n],
    ]);
    const other = await xlsx([["PT UJI (revisi)"], ["Date", "", "31/05/2026", ""], ["Assets"], ["1-1000", "BANK", 2, ""], ["1-1200", "Account Receivable", 1, ""], ["Equity"], ["3-3000", "Share Capital", 3, ""]], "31-05-2026");
    await expect(stageImport(db, { firmId: g.firm.id, clientId: g.client.id, fileName: "balance_sheet-2.xlsx", data: other, entityId: g.pt.entity.id })).rejects.toThrow(/Saldo awal entitas ini sudah ada/);
  });

  it("CONVERT mode posts foreign lines with fx amount and rate (SGD entity, USD lines)", async () => {
    const g = await makeGroup();
    await db.entity.update({ where: { id: g.pt.entity.id }, data: { functionalCurrency: "SGD" } });
    await upsertRate(db, g.firm.id, { currency: "USD", quote: "SGD", date: dateOnly(2023, 1, 1), kind: "SPOT", rate: "1.34" });
    const file = await xlsx([
      H,
      ["PT Uji", d(2023, 1, 3), "10001", "Bank OCBC USD", "USD", 150000, 0, "Rate: 1.31"],
      ["PT Uji", d(2023, 1, 3), "20000", "Long Term Loan Payable", "SGD", 0, 196500, ""],
      ["PT Uji", d(2023, 2, 5), "41000", "Expense Bank Administration", "USD", 10, 0, ""],
      ["PT Uji", d(2023, 2, 5), "10000", "Bank OCBC SGD", "SGD", 0, 13.4, ""],
    ]);
    const staged = await stageImport(db, { firmId: g.firm.id, clientId: g.client.id, fileName: "hc.xlsx", data: file, currencyMode: "CONVERT" });
    if (staged.status !== "STAGED") throw new Error("not staged");
    expect(staged.checks.filter((c) => c.severity === "BLOCK")).toEqual([]);
    await mapAllBySuggestion(g.client.id, staged.importId);
    await postImport(db, g.client.id, staged.importId);
    const lines = await db.journalLine.findMany({ where: { entry: { ledgerImportId: staged.importId }, currency: { not: null } }, orderBy: { date: "asc" } });
    expect(lines.map((l) => [l.debit, l.currency, l.fxAmount, l.fxRate])).toEqual([
      [19_650_000n, "USD", 15_000_000n, "1.31"],
      [1_340n, "USD", 1_000n, "1.34"],
    ]);
  });
});
