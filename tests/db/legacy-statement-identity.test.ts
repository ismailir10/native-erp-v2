import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { importStatement } from "@/lib/import/pipeline";
import { readValidation } from "@/lib/import/validation";

const source = (rows: string[], closing: number) => Buffer.from([
  "Informasi Rekening - Mutasi Rekening", "No. rekening : 1111111111",
  "Periode : 01/08/2026 - 31/08/2026",
  "Tanggal Transaksi,Keterangan,Cabang,Jumlah,,Saldo",
  ...rows, "Saldo Awal : 1000", `Saldo Akhir : ${closing}`,
].join("\n"));
const counts = async () => ({ rows: await db.bankTransaction.count(), journals: await db.journalEntry.count(), lines: await db.journalLine.count() });

describe("complete legacy statement identity before row-level ambiguity", () => {
  beforeEach(resetDb);

  it.each([
    ["sparse same-day balances", ["31/08/2026,CUSTOMER A,0000,100,CR,", "31/08/2026,CUSTOMER B,0000,200,CR,", "31/08/2026,CUSTOMER C,0000,300,CR,1600"], 1600],
    ["complete same-day balance cycle", ["31/08/2026,BIAYA ADM,0000,100,DB,900", "31/08/2026,CUSTOMER A,0000,100,CR,1000"], 1000],
  ] as const)("revalidates an exact legacy reupload with %s without writing financial rows", async (_label, rows, closing) => {
    const g = await makeGroup();
    const data = source([...rows], closing);
    const args = { bankAccountId: g.pt.banks[0].id, fileName: "original.csv", data, provider: null };
    const first = await importStatement(db, args);
    await db.$executeRaw`UPDATE "StatementImport" SET "sourceValidation" = NULL WHERE id = ${first.importId}`;
    const before = await counts();
    const originalRows = await db.bankTransaction.findMany({ where: { importId: first.importId }, orderBy: { rowNumber: "asc" } });
    const again = await importStatement(db, { ...args, fileName: "original-renamed.csv" });
    expect(again.duplicates).toBe(rows.length);
    expect(await counts()).toEqual(before);
    expect(await db.bankTransaction.findMany({ where: { importId: first.importId }, orderBy: { rowNumber: "asc" } })).toEqual(originalRows);
    const legacy = await db.statementImport.findUniqueOrThrow({ where: { id: first.importId } });
    expect(readValidation(legacy.sourceValidation)?.issues).toEqual([]);
    expect(readValidation(legacy.sourceValidation)?.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect((await importStatement(db, args)).duplicates).toBe(rows.length);
    expect(await counts()).toEqual(before);
  });

  it("does not attest stale hashes after a stored source description changes", async () => {
    const g = await makeGroup();
    const data = source(["31/08/2026,BIAYA ADM,0000,100,DB,900", "31/08/2026,CUSTOMER A,0000,100,CR,1000"], 1000);
    const args = { bankAccountId: g.pt.banks[0].id, fileName: "cycle.csv", data, provider: null };
    const first = await importStatement(db, args);
    await db.$executeRaw`UPDATE "StatementImport" SET "sourceValidation" = NULL WHERE id = ${first.importId}`;
    const stored = await db.bankTransaction.findFirstOrThrow({ where: { importId: first.importId }, orderBy: { rowNumber: "asc" } });
    // Model old/corrupt metadata: the recorded hash still describes the original text.
    await db.bankTransaction.update({ where: { id: stored.id }, data: { description: "CHANGED SOURCE DESCRIPTION" } });
    const before = await counts();
    await expect(importStatement(db, args)).rejects.toThrow(/saldo tidak membuktikan identitas/);
    expect(await counts()).toEqual(before);
    expect(readValidation((await db.statementImport.findUniqueOrThrow({ where: { id: first.importId } })).sourceValidation)).toBeNull();
    expect((await db.bankTransaction.findUniqueOrThrow({ where: { id: stored.id } })).hash).toBe(stored.hash);
  });

  it("does not attest a complete matching source whose period is explicitly unverified", async () => {
    const g = await makeGroup();
    const data = source(["31/08/2026,BIAYA ADM,0000,100,DB,900", "31/08/2026,CUSTOMER A,0000,100,CR,1000"], 1000);
    const args = { bankAccountId: g.pt.banks[0].id, fileName: "cycle.csv", data, provider: null };
    const first = await importStatement(db, args);
    await db.$executeRaw`UPDATE "StatementImport" SET "sourceValidation" = NULL WHERE id = ${first.importId}`;
    const before = await counts();
    await expect(importStatement(db, { ...args, sourceProvenance: { period: "INFERRED", opening: "PRINTED", closing: "PRINTED" } })).rejects.toThrow(/saldo tidak membuktikan identitas/);
    expect(await counts()).toEqual(before);
    expect(readValidation((await db.statementImport.findUniqueOrThrow({ where: { id: first.importId } })).sourceValidation)).toBeNull();
  });

  it("revalidates an exact legacy MT940 with same-day transactions and only a final balance", async () => {
    const g = await makeGroup();
    const data = Buffer.from([
      ":20:COMPLETE", ":25:1111111111", ":28C:1/1", ":60F:C260731IDR1000,00",
      ":61:2608310831C100,00NTRFNONREF", ":86:CUSTOMER A",
      ":61:2608310831C200,00NTRFNONREF", ":86:CUSTOMER B", ":62F:C260831IDR1300,00",
    ].join("\n"));
    const args = { bankAccountId: g.pt.banks[0].id, fileName: "complete.mt940", data, provider: null };
    const first = await importStatement(db, args);
    await db.$executeRaw`UPDATE "StatementImport" SET "sourceValidation" = NULL WHERE id = ${first.importId}`;
    const before = await counts();
    expect((await importStatement(db, args)).duplicates).toBe(2);
    expect(await counts()).toEqual(before);
    expect(readValidation((await db.statementImport.findUniqueOrThrow({ where: { id: first.importId } })).sourceValidation)?.issues).toEqual([]);
  });

  it("does not use a partial legacy cycle as whole-statement identity", async () => {
    const g = await makeGroup();
    const rows = ["31/08/2026,BIAYA ADM,0000,100,DB,900", "31/08/2026,CUSTOMER A,0000,100,CR,1000"];
    const args = { bankAccountId: g.pt.banks[0].id, fileName: "cycle.csv", provider: null };
    const first = await importStatement(db, { ...args, data: source(rows, 1000) });
    await db.$executeRaw`UPDATE "StatementImport" SET "sourceValidation" = NULL WHERE id = ${first.importId}`;
    const before = await counts();
    await expect(importStatement(db, { ...args, data: source([rows[0]], 900) })).rejects.toThrow(/saldo tidak membuktikan identitas/);
    expect(await counts()).toEqual(before);
    expect(readValidation((await db.statementImport.findUniqueOrThrow({ where: { id: first.importId } })).sourceValidation)).toBeNull();
  });
});
