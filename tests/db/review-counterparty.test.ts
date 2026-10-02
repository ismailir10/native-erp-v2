import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { db, makeGroup, resetDb } from "../helpers";
import { importStatement } from "@/lib/import/pipeline";
import { acceptSimilar, reviewTransaction } from "@/lib/review";
import { ownerQuestions, ownerQuestionsWorkbook } from "@/lib/review-questions";
import { dateOnly } from "@/lib/format";

/** UC-B3: five Rp 100 jt payments on one date to five resellers are five decisions, never one last-write-wins key. */
const resellers = ["DEWI ANGGRAINI", "HENDRA SAPUTRA", "MEGA LESTARI", "YOGI PRATAMA", "FITRI HANDAYANI"];
const file = (month: string, opening: string) =>
  Buffer.from(
    [
      "Tanggal;Keterangan;Debet;Kredit;Saldo",
      `01/${month}/2026;SALDO AWAL;;;${opening}`,
      ...resellers.map((r, i) => `15/${month}/2026;TRSF E-BANKING DB 1508/FTSCY/WS90${i}11 ${r};100.000.000,00;0,00;`),
      `16/${month}/2026;TRSF E-BANKING DB 1608/FTSCY/WS90999 TOKO KECIL;250.000,00;0,00;`,
      "",
    ].join("\n"),
  );

describe("decisions keyed by counterparty", () => {
  beforeEach(resetDb);

  it("accepting one reseller touches none of the others, and next month only that reseller is remembered", async () => {
    const g = await makeGroup();
    const bank = g.pt.banks[0].id;
    await importStatement(db, { bankAccountId: bank, fileName: "jul.csv", data: file("07", "1.000.000.000,00"), provider: null });
    const lines = await db.bankTransaction.findMany({ where: { bankAccountId: bank, amount: -100_000_000n }, orderBy: { rowNumber: "asc" } });
    expect(new Set(lines.map((l) => l.merchantKey)).size).toBe(5);

    await reviewTransaction(db, { bankTxId: lines[0].id, accountCode: "1170", taxTag: null }); // an advance to Dewi
    const decided = await acceptSimilar(db, lines[0].id, undefined, null, { accountCode: "1170", taxTag: null });
    expect(decided).toHaveLength(0); // nothing else carries Dewi's key
    expect(await db.bankTransaction.count({ where: { bankAccountId: bank, status: "NEEDS_REVIEW", amount: -100_000_000n } })).toBe(4);

    await importStatement(db, { bankAccountId: bank, fileName: "agu.csv", data: file("08", "499.750.000,00"), provider: null });
    const aug = await db.bankTransaction.findMany({ where: { bankAccountId: bank, date: dateOnly(2026, 8, 15) }, orderBy: { rowNumber: "asc" } });
    expect(aug.map((t) => [t.status, t.method])).toEqual([["POSTED", "MEMORY"], ...resellers.slice(1).map(() => ["NEEDS_REVIEW", "HEURISTIC"])]);
  });

  it("lists the questions for the client largest first, and the Excel carries an empty answer column", async () => {
    const g = await makeGroup();
    await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "jul.csv", data: file("07", "1.000.000.000,00"), provider: null });
    const rows = await ownerQuestions(db, { firmId: g.firm.id, clientId: g.client.id, entityIds: [g.pt.entity.id], through: dateOnly(2026, 7, 31) });
    expect(rows.map((r) => r.amount)).toEqual([...resellers.map(() => -100_000_000n), -250_000n]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await ownerQuestionsWorkbook(rows, { firm: "KJA Uji", client: "Grup Uji", through: dateOnly(2026, 7, 31) })) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Pertanyaan")!;
    expect(ws.getRow(5).values).toContain("Jawaban klien");
    expect(ws.getRow(6).getCell(7).value).toBe(100_000_000);
    expect(ws.getRow(11).getCell(10).value).toBe("Uang ini ke siapa dan untuk apa?");
  });
});
