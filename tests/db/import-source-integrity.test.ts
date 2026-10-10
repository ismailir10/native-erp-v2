import { beforeEach, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { importStatement } from "@/lib/import/pipeline";
beforeEach(resetDb);
it.each([
  ["USD source", "Account USD 1111111111\nDate;Description;Debit (USD);Credit (USD);Balance (USD)\n2026-08-01;CUSTOMER;0;10.50;110.50", /valas|Rupiah|IDR/],
  ["invalid BCA day", "Informasi Rekening - Mutasi Rekening\nNo. rekening : 1111111111\nPeriode : 01/02/2026 - 28/02/2026\nTanggal Transaksi,Keterangan,Cabang,Jumlah,,Saldo\n31/02,CUSTOMER,0001,100,CR,1100\nSaldo Awal : 1000\nSaldo Akhir : 1100\n", /kalender/],
  ["missing MT940 closing", ":20:A\n:25:1111111111\n:60F:C260731IDR1000,00\n:61:260801C100,00NTRFNONREF\n", /saldo akhir|penutup|62/],
] as const)("refuses %s before writing any import, transaction or journal", async (_name, text, message) => {
  const g = await makeGroup();
  await expect(importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "source.txt", data: Buffer.from(text), provider: null })).rejects.toThrow(message);
  expect(await db.statementImport.count()).toBe(0);
  expect(await db.bankTransaction.count()).toBe(0);
  expect(await db.journalEntry.count()).toBe(0);
});
it("does not reinterpret an impossible native BCA month through a fallback locale", async () => {
  const g = await makeGroup();
  const text = "Informasi Rekening\nPeriode : 01/02/2026 - 28/02/2026\nTanggal Transaksi,Keterangan,Cabang,Jumlah,,Saldo\n01/13,Receipt,000,100,CR,1100\nSaldo Awal : 1000";
  await expect(importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca.csv", data: Buffer.from(text), provider: null })).rejects.toThrow(/kalender/);
  expect(await db.journalEntry.count()).toBe(0);
});
it("refuses IDR input into a foreign-currency account at the domain boundary", async () => {
  const g = await makeGroup();
  await db.bankAccount.update({ where: { id: g.pt.banks[0].id }, data: { currency: "USD" } });
  await expect(importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "source.csv", data: Buffer.from("Tanggal;Keterangan;Debet;Kredit;Saldo\n2026-08-01;CUSTOMER;0;100;1100"), provider: null })).rejects.toThrow(/Rupiah/);
  expect(await db.journalEntry.count()).toBe(0);
});

it("refuses an unresolved moved balance without posting the other readable rows", async () => {
  await resetDb();
  const g = await makeGroup();
  const data = Buffer.from("Tanggal;Keterangan;Debet;Kredit;Saldo\n01/08/2026;SALDO AWAL;;;1000\n02/08/2026;SETOR;;100;1100\n03/08/2026;NOMINAL HILANG;;;1300\n");
  await expect(importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "missing.csv", data, provider: null })).rejects.toThrow(/nominal transaksi belum terbukti/);
  expect(await db.statementImport.count()).toBe(0);
  expect(await db.bankTransaction.count()).toBe(0);
  expect(await db.journalEntry.count()).toBe(0);
});
