import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import type { Db } from "@/lib/db";
import { importStatement } from "@/lib/import/pipeline";
import { guardTransferCounterparts } from "@/lib/import/transfer-guard";
import { reviewTransaction } from "@/lib/review";

const file = (out: boolean) => Buffer.from([
  "Tanggal;Keterangan;Debet;Kredit;Saldo",
  "01/08/2026;SALDO AWAL;;;1.000.000,00",
  `05/08/2026;PINDAH BUKU PT UJI SEJAHTERA;${out ? "500.000,00;0,00;500.000,00" : "0,00;500.000,00;1.500.000,00"}`,
  "",
].join("\n"));

async function openHalf() {
  const g = await makeGroup();
  await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "out.csv", data: file(true), provider: null });
  const half = await db.bankTransaction.findFirstOrThrow({ where: { bankAccountId: g.pt.banks[0].id } });
  return { g, half };
}

beforeEach(resetDb);

describe("transfer counterpart concurrency", () => {
  it("lets only one of two simultaneous account imports consume an existing transfer half", async () => {
    const { g, half } = await openHalf();
    let arrivals = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    // Hold both counterpart snapshots until both importers have read the same unpaired half. No sleeps or AI calls.
    const concurrent = db.$extends({ query: { bankTransaction: { async findMany({ args, query }) {
      const rows = await query(args);
      if (args.where?.matchedTxId === null) {
        arrivals++;
        if (arrivals === 2) release();
        await gate;
      }
      return rows;
    } } } }) as unknown as Db;
    const results = await Promise.allSettled([g.pt.banks[1], g.owner.banks[0]].map((bank) => importStatement(concurrent, {
      bankAccountId: bank.id, fileName: `${bank.bank}.csv`, data: file(false), provider: null,
    })));
    expect(arrivals).toBe(2);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected?.reason.message).toMatch(/pasangan transfer.*berubah|sudah digunakan/);
    const rows = await db.bankTransaction.findMany();
    expect(rows).toHaveLength(2);
    expect(await db.statementImport.count()).toBe(2);
    const out = rows.find((r) => r.id === half.id)!;
    const incoming = rows.find((r) => r.id !== half.id)!;
    expect(out.matchedTxId).toBe(incoming.id);
    expect(incoming.matchedTxId).toBe(out.id);
    const entries = await db.journalEntry.findMany({ include: { lines: true } });
    for (const entry of entries) expect(entry.lines.reduce((sum, line) => sum + line.debit - line.credit, 0n)).toBe(0n);
  });

  it("does not overwrite a manual classification made after the counterpart snapshot", async () => {
    const { g, half } = await openHalf();
    await reviewTransaction(db, { bankTxId: half.id, accountCode: "5100", taxTag: null });
    await expect(db.$transaction((tx) => guardTransferCounterparts(tx, g.client.id, [half]))).rejects.toThrow(/pasangan transfer.*berubah/);
    expect((await db.bankTransaction.findUniqueOrThrow({ where: { id: half.id } })).accountCode).toBe("5100");
  });

  it("rechecks refusal and client ownership under the row lock", async () => {
    const { g, half } = await openHalf();
    await expect(db.$transaction((tx) => guardTransferCounterparts(tx, "another-client", [half]))).rejects.toThrow(/pasangan transfer/);
    await db.bankTransaction.update({ where: { id: half.id }, data: { pairRefused: true } });
    await expect(db.$transaction((tx) => guardTransferCounterparts(tx, g.client.id, [half]))).rejects.toThrow(/pasangan transfer/);
  });
  it("does not pair equal minor-unit amounts across currencies", async () => {
    const { g, half } = await openHalf();
    // A legacy foreign bank row must not match an IDR movement by numeric equality.
    await db.bankAccount.update({ where: { id: g.pt.banks[0].id }, data: { currency: "USD" } });
    await importStatement(db, { bankAccountId: g.owner.banks[0].id, fileName: "idr.csv", data: file(false), provider: null });
    expect((await db.bankTransaction.findUniqueOrThrow({ where: { id: half.id } })).matchedTxId).toBeNull();
    expect(await db.bankTransaction.count({ where: { matchedTxId: { not: null } } })).toBe(0);
  });

});
