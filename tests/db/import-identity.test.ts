import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { importStatement } from "@/lib/import/pipeline";
import { dedupeStatement } from "@/lib/import/dedupe";
import { parseStatement } from "@/lib/import/parsers";
import { rowHashes } from "@/lib/import/normalize";
import { dateOnly } from "@/lib/format";

const file = (opening: number, description: string, balance: number | null = opening + 100) => Buffer.from([
  "Tanggal;Keterangan;Debet;Kredit;Saldo",
  `13/08/2026;SALDO AWAL;0;0;${opening}`,
  `13/08/2026;${description};0;100;${balance ?? ""}`,
].join("\n"));
const counts = async () => ({ imports: await db.statementImport.count(), rows: await db.bankTransaction.count(), journals: await db.journalEntry.count(), lines: await db.journalLine.count() });

describe("bank source identity at the posting boundary", () => {
  beforeEach(resetDb);

  it("keeps distinct equal receipts from successive same-day slices and posts every amount once", async () => {
    const g = await makeGroup();
    const bank = g.pt.banks[0];
    for (const [opening, description] of [[1000, "CUSTOMER A"], [1100, "CUSTOMER B"], [1200, "CUSTOMER C"]] as const) {
      const result = await importStatement(db, { bankAccountId: bank.id, fileName: `${description}.csv`, data: opening === 1000 ? Buffer.concat([Buffer.from("\n".repeat(10)), file(opening, description)]) : file(opening, description), provider: null });
      expect(result.duplicates).toBe(0);
    }
    const stored = await db.bankTransaction.findMany({ where: { bankAccountId: bank.id }, orderBy: { balance: "asc" } });
    expect(stored.map((r) => [r.description, r.amount, r.balance])).toEqual([["CUSTOMER A", 100n, 1100n], ["CUSTOMER B", 100n, 1200n], ["CUSTOMER C", 100n, 1300n]]);
    const lines = await db.journalLine.findMany({ where: { accountId: bank.accountId } });
    expect(lines.reduce((sum, line) => sum + line.debit - line.credit, 0n)).toBe(300n);
    const before = await counts();
    const again = await importStatement(db, { bankAccountId: bank.id, fileName: "renamed.csv", data: file(1100, "CUSTOMER B"), provider: null });
    expect(again.duplicates).toBe(1);
    expect(await counts()).toEqual(before);
  });

  it("deduplicates differently worded sources only when their printed balances prove identity", async () => {
    const g = await makeGroup();
    const args = { bankAccountId: g.pt.banks[0].id, fileName: "source.csv", provider: null };
    await importStatement(db, { ...args, data: file(1000, "CUSTOMER A") });
    const before = await counts();
    const again = await importStatement(db, { ...args, data: file(1000, "BANK REFERENCE A") });
    expect(again.duplicates).toBe(1);
    expect(again.notes.join(" ")).toMatch(/tanggal, nominal, dan saldo/);
    expect(await counts()).toEqual({ ...before, imports: before.imports + 1 }); // retain the second source evidence, without posting
  });

  it.each([
    ["missing incoming balance", 1000, null],
    ["contradictory opening and different balance", 1200, 1300],
  ] as const)("refuses %s before any persistent change", async (_label, opening, balance) => {
    const g = await makeGroup();
    const args = { bankAccountId: g.pt.banks[0].id, fileName: "source.csv", provider: null };
    await importStatement(db, { ...args, data: file(1000, "CUSTOMER A") });
    const before = await counts();
    await expect(importStatement(db, { ...args, data: file(opening, "CUSTOMER B", balance) })).rejects.toThrow(/saldo tidak membuktikan identitas/);
    expect(await counts()).toEqual(before);
  });

  it("does not use a derived opening as proof of a new equal receipt", async () => {
    const g = await makeGroup();
    const args = { bankAccountId: g.pt.banks[0].id, fileName: "source.csv", provider: null };
    await importStatement(db, { ...args, data: file(1000, "CUSTOMER A") });
    const before = await counts();
    const incoming = Buffer.from("Tanggal;Keterangan;Debet;Kredit;Saldo\n13/08/2026;CUSTOMER B;0;100;1200");
    await expect(importStatement(db, { ...args, data: incoming })).rejects.toThrow(/saldo tidak membuktikan identitas/);
    expect(await counts()).toEqual(before);
  });

  it("refuses continuation when a stored row has no balance to prove the chain", async () => {
    const g = await makeGroup();
    const args = { bankAccountId: g.pt.banks[0].id, fileName: "source.csv", provider: null };
    await importStatement(db, { ...args, data: file(1000, "CUSTOMER A", null) });
    const before = await counts();
    await expect(importStatement(db, { ...args, data: file(1100, "CUSTOMER B") })).rejects.toThrow(/saldo tidak membuktikan identitas/);
    expect(await counts()).toEqual(before);
  });

  it("does not erase a new fee whose row hash repeats after a same-day balance cycle", async () => {
    const g = await makeGroup();
    const args = { bankAccountId: g.pt.banks[0].id, fileName: "cycle.csv", provider: null };
    const cycle = Buffer.from([
      "Tanggal;Keterangan;Debet;Kredit;Saldo",
      "13/08/2026;SALDO AWAL;0;0;1000",
      "13/08/2026;BIAYA ADM;100;0;900",
      "13/08/2026;CUSTOMER A;0;100;1000",
    ].join("\n"));
    await importStatement(db, { ...args, data: cycle });
    const before = await counts();
    const same = await importStatement(db, { ...args, fileName: "renamed-cycle.csv", data: cycle });
    expect(same.duplicates).toBe(2);
    expect(await counts()).toEqual(before);
    const nextFee = Buffer.from([
      "Tanggal;Keterangan;Debet;Kredit;Saldo",
      "13/08/2026;SALDO AWAL;0;0;1000",
      "13/08/2026;BIAYA ADM;100;0;900",
    ].join("\n"));
    await expect(importStatement(db, { ...args, fileName: "later-fee.csv", data: nextFee })).rejects.toThrow(/saldo tidak membuktikan identitas/);
    expect(await counts()).toEqual(before);
    await expect(importStatement(db, { ...args, data: Buffer.concat([cycle, Buffer.from("\n")]) })).rejects.toThrow(/saldo tidak membuktikan identitas/);
    expect(await counts()).toEqual(before);
  });

  it("finds the as-written identity even when a repair moves the date outside the original range", async () => {
    const g = await makeGroup();
    const bankAccountId = g.pt.banks[0].id;
    const data = file(1000, "CUSTOMER A");
    await importStatement(db, { bankAccountId, fileName: "source.csv", data, provider: null });
    const parsed = await parseStatement("source.csv", data);
    const written = rowHashes(parsed.rows);
    const repaired = { ...parsed, periodStart: dateOnly(2026, 9, 1), periodEnd: dateOnly(2026, 9, 30), rows: parsed.rows.map((r) => ({ ...r, date: dateOnly(2026, 9, 13) })) };
    const result = await dedupeStatement(db, bankAccountId, repaired, rowHashes(repaired.rows), written);
    expect(result.duplicate).toEqual([true]);
    expect(result.notes.join(" ")).toMatch(/sebelum diperbaiki/);
    expect(await db.bankTransaction.count()).toBe(1);
  });
});
