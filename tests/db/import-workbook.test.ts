import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { workbook, type FixtureCell, type FixtureSheet } from "../xls-fixture";
import { importStatement } from "@/lib/import/pipeline";
import { postOpening } from "@/lib/opening";
import { runControls } from "@/lib/controls";
import { dateOnly } from "@/lib/format";
import { YearNeededError } from "@/lib/import/types";

const HEADER: FixtureCell[] = ["TANGGAL", null, "KETERANGAN", "DEBET", "KREDIT", "SISA SALDO"];

/** An accountant's month-per-sheet copy of the BCA Giro statement (invented figures): no year, debet = money in. */
function workingCopy(junOpening = 12_970_000): Buffer {
  const sheets: FixtureSheet[] = [
    { name: "MAY", rows: [HEADER, ["01/05", "SALDO AWAL", null, null, null, 10_000_000], ["02/05", "TRSF E-BANKING CR", "TOKO SATU", 3_000_000, null, 13_000_000], ["31/05", "BIAYA ADM", null, null, 30_000, 12_970_000]] },
    { name: "JUN", rows: [HEADER, ["01/06", "SALDO AWAL", null, null, null, junOpening], ["03/06", "TRSF E-BANKING CR", "TOKO DUA", 5_000_000, null, junOpening + 5_000_000]] },
    { name: "JUL", rows: [HEADER, ["01/07", "SALDO AWAL", null, null, null, 17_970_000], ["09/07", "BIAYA ADM", null, null, 30_000, 17_940_000]] },
  ];
  return workbook(sheets, "biff8");
}

describe("workbook statement import", () => {
  beforeEach(resetDb);

  it("asks for the year, then posts three months in one import with sheets and notes kept", async () => {
    const g = await makeGroup();
    const bankAccountId = g.pt.banks[0].id;
    const fileName = "BCA_GIRO_MAY_26-JUL_26.xls";
    await expect(importStatement(db, { bankAccountId, fileName, data: workingCopy(), provider: null })).rejects.toBeInstanceOf(YearNeededError);
    expect(await db.statementImport.count()).toBe(0);

    await postOpening(db, { clientId: g.client.id, entityId: g.pt.entity.id, date: dateOnly(2026, 4, 30), lines: [{ accountCode: "1101", debit: "10000000", credit: "0" }] });
    const s = await importStatement(db, { bankAccountId, fileName, data: workingCopy(), provider: null, year: 2026 });
    expect(s).toMatchObject({ rows: 4, continuityOk: true, months: ["Mei 2026", "Juni 2026", "Juli 2026"] });
    expect(s.notes[1]).toMatch(/Kolom Debet dibaca sebagai uang masuk/);

    const imp = await db.statementImport.findUniqueOrThrow({ where: { id: s.importId } });
    expect(imp.parseNotes).toEqual(s.notes);
    expect(imp.periodStart.toISOString().slice(0, 10)).toBe("2026-05-01");
    expect(imp.periodEnd.toISOString().slice(0, 10)).toBe("2026-07-31");
    const txs = await db.bankTransaction.findMany({ where: { importId: s.importId }, orderBy: { date: "asc" } });
    expect(txs.map((t) => [t.sourceSheet, t.rowNumber, t.amount])).toEqual([["MAY", 3, 3_000_000n], ["MAY", 4, -30_000n], ["JUN", 3, 5_000_000n], ["JUL", 3, -30_000n]]);

    for (const month of [5, 6, 7]) {
      const bank = (await runControls(db, g.client.id, 2026, month)).find((c) => c.key === `bank:${bankAccountId}`);
      expect(bank?.status, `bulan ${month}`).toBe("REVIEW"); // inferred worksheet dates do not prove a full month
    }
  });

  it("marks a gap between sheets for review", async () => {
    const g = await makeGroup();
    const s = await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "giro.xls", data: workingCopy(12_000_000), provider: null, year: 2026 });
    expect(s.continuityOk).toBe(false);
    expect(s.continuityNote).toMatch(/JUN!3/);
    const cont = (await runControls(db, g.client.id, 2026, 6)).find((c) => c.key === `cont:${g.pt.banks[0].id}`);
    expect(cont?.status).toBe("FAIL");
  });

  it("refuses ambiguous overlap instead of losing or double counting a transfer", async () => {
    const g = await makeGroup();
    const bankAccountId = g.pt.banks[0].id;
    await postOpening(db, { clientId: g.client.id, entityId: g.pt.entity.id, date: dateOnly(2026, 4, 30), lines: [{ accountCode: "1101", debit: "10000000", credit: "0" }] });
    await importStatement(db, { bankAccountId, fileName: "salinan.xls", data: workingCopy(), provider: null, year: 2026 });
    // The bank's own export of May and June: other wording, the balance only on the day's last line, and one more 3 jt transfer on
    // 2 May that the Excel copy missed.
    const csv = [
      "Tanggal;Keterangan;Debet;Kredit;Saldo",
      "01/05/2026;SALDO AWAL;0;0;10000000",
      "02/05/2026;TRSF E-BANKING CR 0205/FTSCY/WS95031 TOKO SATU BAYAR;0;3000000;",
      "02/05/2026;TRSF E-BANKING CR 0205/FTSCY/WS95032 TOKO LAIN;0;3000000;16000000",
      "31/05/2026;BIAYA ADM;30000;0;15970000",
      "03/06/2026;TRSF E-BANKING CR TOKO DUA MEI;0;5000000;20970000",
      "",
    ].join("\n");
    const before = await db.journalEntry.count();
    await expect(importStatement(db, { bankAccountId, fileName: "bca-mei-juni.csv", data: Buffer.from(csv), provider: null })).rejects.toThrow(/saldo tidak membuktikan identitasnya/);
    expect(await db.bankTransaction.count()).toBe(4);
    expect(await db.journalEntry.count()).toBe(before);
  });

  it("recognizes a cross-source line only with its matching balance", async () => {
    const g = await makeGroup();
    const bankAccountId = g.pt.banks[0].id;
    await importStatement(db, { bankAccountId, fileName: "salinan.xls", data: workingCopy(), provider: null, year: 2026 });
    // A one-line supplement for 2 May: same date and amount as TOKO SATU's transfer, but the file doesn't hold May's other lines.
    const csv = ["Tanggal;Keterangan;Debet;Kredit;Saldo", "01/05/2026;SALDO AWAL;0;0;10000000", "02/05/2026;SETORAN TUNAI CABANG;0;3000000;13000000", ""].join("\n");
    const s = await importStatement(db, { bankAccountId, fileName: "tambahan.csv", data: Buffer.from(csv), provider: null });
    expect(s).toMatchObject({ rows: 1, duplicates: 1 });
    expect(s.notes.some((n) => n.includes("tanggal, nominal, dan saldo yang sama"))).toBe(true);
    expect(await db.bankTransaction.count({ where: { bankAccountId, date: dateOnly(2026, 5, 2) } })).toBe(1);
  });

  it("never posts two copies of a statement imported at the same time", async () => {
    const g = await makeGroup();
    const bankAccountId = g.pt.banks[0].id;
    const csv = ["Tanggal;Keterangan;Debet;Kredit;Saldo", "01/05/2026;SALDO AWAL;0;0;10000000", "02/05/2026;TRSF CR TOKO SATU BAYAR;0;3000000;13000000", "31/05/2026;BIAYA ADM;30000;0;12970000", ""].join("\n");
    const results = await Promise.allSettled([
      importStatement(db, { bankAccountId, fileName: "salinan.xls", data: workingCopy(), provider: null, year: 2026 }),
      importStatement(db, { bankAccountId, fileName: "bca-mei.csv", data: Buffer.from(csv), provider: null }),
    ]);
    // Either the second saw the first and skipped its lines, or it refused and asks to retry; May holds each line once.
    for (const r of results) if (r.status === "rejected") expect(String(r.reason)).toMatch(/Ulangi impor file ini/);
    expect(await db.bankTransaction.count({ where: { bankAccountId, date: { gte: dateOnly(2026, 5, 1), lte: dateOnly(2026, 5, 31) } } })).toBe(2);
  });
});
