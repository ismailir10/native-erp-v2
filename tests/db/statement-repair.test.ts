import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { importStatement } from "@/lib/import/pipeline";
import { rowHash } from "@/lib/import/normalize";

/** UC-B1 through the pipeline: a repaired row posts as the balance says, the import notes it, and a second import adds nothing. */
const file = (...rows: string[]) => Buffer.from(["Tanggal;Keterangan;Debet;Kredit;Saldo", "01/08/2026;SALDO AWAL;;;10.000.000,00", ...rows, ""].join("\n"));
// Row 4 is written as money in, but the balance falls by it: its direction was typed the wrong way.
const inverted = file("03/08/2026;SETORAN TUNAI;0,00;1.000.000,00;11.000.000,00", "05/08/2026;BAYAR TOKO SUMBER;0,00;500.000,00;10.500.000,00", "07/08/2026;SETORAN TUNAI;0,00;2.000.000,00;12.500.000,00");

describe("statement repair in the pipeline (UC-B1)", () => {
  beforeEach(resetDb);

  it("posts the flipped row as the balance says, notes what the file wrote, and imports nothing the second time", async () => {
    const g = await makeGroup();
    const bca = g.pt.banks[0];
    const first = await importStatement(db, { bankAccountId: bca.id, fileName: "agu.csv", data: inverted, provider: null });
    expect(first.rows).toBe(3);
    const imp = await db.statementImport.findFirstOrThrow({ where: { bankAccountId: bca.id } });
    expect(imp.continuityOk).toBe(true);
    expect(imp.parseNotes).toEqual([expect.stringMatching(/^Baris 4: arah dibalik — file menulis masuk Rp 500.000, tetapi saldo turun sebesar itu/)]);
    const row = await db.bankTransaction.findFirstOrThrow({ where: { bankAccountId: bca.id, description: { contains: "BAYAR TOKO" } } });
    expect(row.amount).toBe(-500_000n);
    expect(row.rawRow).toContain("500.000,00");

    const again = await importStatement(db, { bankAccountId: bca.id, fileName: "agu.csv", data: inverted, provider: null });
    expect([again.rows, again.duplicates]).toEqual([3, 3]);
    expect(await db.bankTransaction.count({ where: { bankAccountId: bca.id } })).toBe(3);
  });

  it("recognises a row imported before the repair existed by what the file wrote: no double", async () => {
    const g = await makeGroup();
    const bca = g.pt.banks[0];
    await importStatement(db, { bankAccountId: bca.id, fileName: "agu.csv", data: inverted, provider: null });
    // As an older import stored it: the written sign and the hash of the written row.
    const row = await db.bankTransaction.findFirstOrThrow({ where: { bankAccountId: bca.id, description: { contains: "BAYAR TOKO" } } });
    const hash = rowHash({ date: row.date, description: row.description, amount: 500_000n, balance: row.balance, rowNumber: row.rowNumber, rawRow: row.rawRow });
    await db.bankTransaction.update({ where: { id: row.id }, data: { amount: 500_000n, hash } });

    const again = await importStatement(db, { bankAccountId: bca.id, fileName: "agu.csv", data: inverted, provider: null });
    expect(again.duplicates).toBe(3);
    expect(again.notes).toEqual(expect.arrayContaining([expect.stringMatching(/^1 baris sudah diimpor sebelumnya seperti tertulis di file/)]));
    expect(await db.bankTransaction.count({ where: { bankAccountId: bca.id } })).toBe(3);
  });
});
