import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { importStatement } from "@/lib/import/pipeline";
import { runControls } from "@/lib/controls";
import { reportStatus } from "@/lib/reports/status";
import { postOpening } from "@/lib/opening";
import { dateOnly } from "@/lib/format";
import { readValidation } from "@/lib/import/validation";

const bca = (rows: string[], options: { start?: string; end?: string; opening?: number; closing?: number } = {}) => Buffer.from([
  "Informasi Rekening - Mutasi Rekening", "No. rekening : 1111111111",
  `Periode : ${options.start ?? "01/08/2026"} - ${options.end ?? "31/08/2026"}`,
  "Tanggal Transaksi,Keterangan,Cabang,Jumlah,,Saldo", ...rows,
  `Saldo Awal : ${options.opening ?? 1000}`,
  ...(options.closing === undefined ? [] : [`Saldo Akhir : ${options.closing}`]),
].join("\n"));
const receipt = (day: string, amount: number, balance: number | null, description = "CUSTOMER A") => `${day},${description},0000,${amount},CR,${balance ?? ""}`;
async function setup() {
  const g = await makeGroup();
  await postOpening(db, { clientId: g.client.id, entityId: g.pt.entity.id, date: dateOnly(2026, 7, 31), lines: [{ accountCode: "1101", debit: "1000", credit: "0" }, { accountCode: "3100", debit: "0", credit: "1000" }] });
  const bank = g.pt.banks[0];
  return { g, bank, load: (data: Buffer, fileName = "statement.csv") => importStatement(db, { bankAccountId: bank.id, fileName, data, provider: null }) };
}
async function statuses(clientId: string, bankId: string) {
  const controls = await runControls(db, clientId, 2026, 8);
  return { bank: controls.find((c) => c.key === `bank:${bankId}`), continuity: controls.find((c) => c.key === `cont:${bankId}`) };
}
async function hasStatementReason(g: Awaited<ReturnType<typeof makeGroup>>, label: string) {
  return (await reportStatus(db, g.client.id, [g.pt.entity.id], 2026, 8)).reasons.some((r) => r.kind === "statements" && r.accounts.includes(label));
}

describe("source validation reaches controls and report status", () => {
  beforeEach(resetDb);

  it("F3 retains a contradictory printed closing and fails reconciliation and completeness", async () => {
    const { g, bank, load } = await setup();
    const result = await load(bca([receipt("01/08/2026", 100, 1100)], { closing: 900 }));
    const source = await db.statementImport.findUniqueOrThrow({ where: { id: result.importId } });
    expect(source.closingBalance).toBe(900n);
    expect(source.continuityOk).toBe(false);
    expect(readValidation(source.sourceValidation)?.issues).toContainEqual(expect.objectContaining({ code: "BALANCE_CONFLICT", severity: "CONFLICT" }));
    const status = await statuses(g.client.id, bank.id);
    expect(status.bank?.status).toBe("FAIL");
    expect(status.continuity?.status).toBe("FAIL");
    expect(await hasStatementReason(g, bank.label)).toBe(true);
  });

  it("F4 a one-day MT940 does not prove an entire month", async () => {
    const { g, bank, load } = await setup();
    await load(Buffer.from(":20:A\n:25:1111111111\n:60F:C260731IDR1000,00\n:61:2608010801C100,00NTRFNONREF\n:62F:C260801IDR1100,00"), "daily.mt940");
    const status = await statuses(g.client.id, bank.id);
    expect(status.bank?.status).toBe("REVIEW");
    expect(status.continuity?.status).toBe("REVIEW");
    expect(await hasStatementReason(g, bank.label)).toBe(true);
  });

  it("F8 uses an independent month-end closing after trailing transactions without balances", async () => {
    const { g, bank, load } = await setup();
    await load(bca([receipt("01/08/2026", 100, 1100), receipt("31/08/2026", 200, null, "CUSTOMER B")], { closing: 1300 }));
    const status = await statuses(g.client.id, bank.id);
    expect(status.bank?.status).toBe("PASS");
    expect(status.continuity?.status).toBe("PASS");
    expect(await hasStatementReason(g, bank.label)).toBe(false);
  });

  it("does not promote old imports with absent provenance to verified evidence", async () => {
    const { g, bank, load } = await setup();
    const result = await load(bca([receipt("31/08/2026", 100, 1100)], { closing: 1100 }));
    await db.$executeRaw`UPDATE "StatementImport" SET "sourceValidation" = NULL WHERE id = ${result.importId}`;
    const status = await statuses(g.client.id, bank.id);
    expect(status.bank?.status).toBe("REVIEW");
    expect(status.continuity?.status).toBe("REVIEW");
    expect(await hasStatementReason(g, bank.label)).toBe(true);
  });

  it("revalidates an exact complete legacy source without changing its financial rows", async () => {
    const { g, bank, load } = await setup();
    const original = bca([receipt("31/08/2026", 100, 1100)], { closing: 1100 });
    const first = await load(original);
    await db.$executeRaw`UPDATE "StatementImport" SET "sourceValidation" = NULL WHERE id = ${first.importId}`;
    const rows = await db.bankTransaction.findMany({ where: { bankAccountId: bank.id }, orderBy: { id: "asc" } });
    const journals = await db.journalEntry.count();
    const lines = await db.journalLine.count();
    expect((await statuses(g.client.id, bank.id)).bank?.status).toBe("REVIEW");
    await load(original, "original-uploaded-again.csv");
    const legacy = await db.statementImport.findUniqueOrThrow({ where: { id: first.importId } });
    expect(readValidation(legacy.sourceValidation)?.issues).toEqual([]);
    expect(await db.bankTransaction.findMany({ where: { bankAccountId: bank.id }, orderBy: { id: "asc" } })).toEqual(rows);
    expect(await db.journalEntry.count()).toBe(journals);
    expect(await db.journalLine.count()).toBe(lines);
    const status = await statuses(g.client.id, bank.id);
    expect(status.bank?.status).toBe("PASS");
    expect(status.continuity?.status).toBe("PASS");
    expect(await hasStatementReason(g, bank.label)).toBe(false);
  });

  it("does not revalidate legacy ownership from date, amount and balance similarity alone", async () => {
    const { g, bank, load } = await setup();
    const first = await load(bca([receipt("31/08/2026", 100, 1100)], { closing: 1100 }));
    await db.$executeRaw`UPDATE "StatementImport" SET "sourceValidation" = NULL WHERE id = ${first.importId}`;
    await load(bca([receipt("31/08/2026", 100, 1100, "DIFFERENT SOURCE WORDING")], { closing: 1100 }), "different-copy.csv");
    const legacy = await db.statementImport.findUniqueOrThrow({ where: { id: first.importId } });
    expect(readValidation(legacy.sourceValidation)).toBeNull();
    expect((await statuses(g.client.id, bank.id)).bank?.status).toBe("REVIEW");
    expect(await hasStatementReason(g, bank.label)).toBe(true);
  });

  it("detects a gap between otherwise individually valid declared intervals", async () => {
    const { g, bank, load } = await setup();
    await load(bca([receipt("01/08/2026", 100, 1100)], { end: "10/08/2026", closing: 1100 }), "part1.csv");
    await load(bca([receipt("31/08/2026", 200, 1300, "CUSTOMER B")], { start: "12/08/2026", opening: 1100, closing: 1300 }), "part2.csv");
    const status = await statuses(g.client.id, bank.id);
    expect(status.bank?.status).toBe("REVIEW");
    expect(status.continuity?.status).toBe("REVIEW");
    expect(await hasStatementReason(g, bank.label)).toBe(true);
  });

  it("detects offsetting balance discontinuities between adjacent complete slices", async () => {
    const { g, bank, load } = await setup();
    await load(bca([receipt("01/08/2026", 100, 1100)], { end: "10/08/2026", closing: 1100 }), "part1.csv");
    await load(bca([receipt("11/08/2026", 200, 1500, "CUSTOMER B")], { start: "11/08/2026", end: "20/08/2026", opening: 1300, closing: 1500 }), "part2.csv");
    await load(bca([receipt("31/08/2026", 300, 1600, "CUSTOMER C")], { start: "21/08/2026", opening: 1300, closing: 1600 }), "part3.csv");
    const status = await statuses(g.client.id, bank.id);
    expect(status.bank?.status).toBe("FAIL");
    expect(status.continuity?.status).toBe("FAIL");
    expect(await hasStatementReason(g, bank.label)).toBe(true);
  });

  it("retains changed closing evidence even with zero new transactions, while identical bytes remain idempotent", async () => {
    const { g, bank, load } = await setup();
    const rows = [receipt("01/08/2026", 100, 1100)];
    const correct = bca(rows, { closing: 1100 });
    const first = await load(correct);
    const journals = await db.journalEntry.count();
    const contradictory = await load(bca(rows, { closing: 900 }), "different-evidence.csv");
    expect(contradictory.duplicates).toBe(1);
    expect(contradictory.importId).not.toBe(first.importId);
    expect(await db.statementImport.count({ where: { bankAccountId: bank.id } })).toBe(2);
    expect(await db.bankTransaction.count({ where: { bankAccountId: bank.id } })).toBe(1);
    expect(await db.journalEntry.count()).toBe(journals);
    expect((await load(correct, "same-evidence-renamed.csv")).importId).toBe(first.importId);
    expect(await db.statementImport.count({ where: { bankAccountId: bank.id } })).toBe(2);
    expect((await statuses(g.client.id, bank.id)).bank?.status).toBe("FAIL");
    expect(await hasStatementReason(g, bank.label)).toBe(true);
  });

  it("fails an overlapping source whose intermediate closing contradicts the posted receipts", async () => {
    const { g, bank, load } = await setup();
    await load(bca([receipt("01/08/2026", 100, 1100)], { end: "20/08/2026", closing: 1100 }), "overlap-a.csv");
    await load(bca([receipt("15/08/2026", 200, 1300, "CUSTOMER B")], { start: "10/08/2026", opening: 1100, closing: 1300 }), "overlap-b.csv");
    const status = await statuses(g.client.id, bank.id);
    expect(status.bank?.status).toBe("FAIL");
    expect(status.continuity?.status).toBe("FAIL");
    expect(await hasStatementReason(g, bank.label)).toBe(true);
  });

  it("accepts overlapping sources whose shared receipt and each closing agree with the ledger", async () => {
    const { g, bank, load } = await setup();
    await load(bca([receipt("01/08/2026", 100, 1100), receipt("15/08/2026", 200, 1300, "CUSTOMER B")], { end: "20/08/2026", closing: 1300 }), "overlap-a.csv");
    const second = await load(bca([receipt("15/08/2026", 200, 1300, "CUSTOMER B")], { start: "10/08/2026", opening: 1100, closing: 1300 }), "overlap-b.csv");
    expect(second.duplicates).toBe(1);
    expect(await db.bankTransaction.count({ where: { bankAccountId: bank.id } })).toBe(2);
    const status = await statuses(g.client.id, bank.id);
    expect(status.bank?.status).toBe("PASS");
    expect(status.continuity?.status).toBe("PASS");
    expect(await hasStatementReason(g, bank.label)).toBe(false);
  });

  it.each(["01/08/2026", "10/08/2026"])("fails a duplicate-only source with an inflated opening on %s even when every closing agrees", async (start) => {
    const { g, bank, load } = await setup();
    await load(bca([receipt("15/08/2026", 100, 1100), receipt("20/08/2026", 200, 1300, "CUSTOMER B")], { closing: 1300 }), "complete.csv");
    const journals = await db.journalEntry.count();
    const second = await load(bca([receipt("20/08/2026", 200, 1300, "CUSTOMER B")], { start, opening: 1100, closing: 1300 }), "inflated-opening.csv");
    expect(second.duplicates).toBe(1);
    expect(await db.journalEntry.count()).toBe(journals);
    const status = await statuses(g.client.id, bank.id);
    expect(status.bank?.status).toBe("FAIL");
    expect(status.continuity?.status).toBe("FAIL");
    expect(await hasStatementReason(g, bank.label)).toBe(true);
  });

  it("compares source openings at book start without assuming a zero prehistory", async () => {
    const g = await makeGroup();
    await postOpening(db, { clientId: g.client.id, entityId: g.pt.entity.id, date: dateOnly(2026, 8, 1), lines: [{ accountCode: "1101", debit: "1000", credit: "0" }, { accountCode: "3100", debit: "0", credit: "1000" }] });
    const bank = g.pt.banks[0];
    await importStatement(db, { bankAccountId: bank.id, fileName: "complete.csv", data: bca([receipt("15/08/2026", 100, 1100), receipt("20/08/2026", 200, 1300, "CUSTOMER B")], { closing: 1300 }), provider: null });
    const status = await statuses(g.client.id, bank.id);
    expect(status.bank?.status).toBe("REVIEW");
    expect(status.continuity?.status).toBe("REVIEW");
    expect(await hasStatementReason(g, bank.label)).toBe(true);
    await importStatement(db, { bankAccountId: bank.id, fileName: "inflated-opening.csv", data: bca([receipt("20/08/2026", 200, 1300, "CUSTOMER B")], { opening: 1100, closing: 1300 }), provider: null });
    const conflict = await statuses(g.client.id, bank.id);
    expect(conflict.bank?.status).toBe("FAIL");
    expect(conflict.continuity?.status).toBe("FAIL");
    expect(await hasStatementReason(g, bank.label)).toBe(true);
  });

  it("does not bless an unverifiable pre-book opening when another source starts on a different day", async () => {
    const g = await makeGroup();
    await postOpening(db, { clientId: g.client.id, entityId: g.pt.entity.id, date: dateOnly(2026, 8, 1), lines: [{ accountCode: "1101", debit: "1000", credit: "0" }, { accountCode: "3100", debit: "0", credit: "1000" }] });
    const bank = g.pt.banks[0];
    await importStatement(db, { bankAccountId: bank.id, fileName: "complete.csv", data: bca([receipt("15/08/2026", 100, 1100), receipt("20/08/2026", 200, 1300, "CUSTOMER B")], { start: "02/08/2026", closing: 1300 }), provider: null });
    expect((await statuses(g.client.id, bank.id)).bank?.status).toBe("PASS");
    await importStatement(db, { bankAccountId: bank.id, fileName: "unverifiable-opening.csv", data: bca([receipt("20/08/2026", 200, 1300, "CUSTOMER B")], { opening: 1100, closing: 1300 }), provider: null });
    const status = await statuses(g.client.id, bank.id);
    expect(status.bank?.status).toBe("REVIEW");
    expect(status.continuity?.status).toBe("REVIEW");
    expect(await hasStatementReason(g, bank.label)).toBe(true);
  });

  it("keeps reports marked incomplete when a multi-month file lacks an August closing checkpoint", async () => {
    const { g, bank, load } = await setup();
    await load(bca([receipt("01/08/2026", 100, 1100), receipt("30/09/2026", 200, 1300, "CUSTOMER B")], { end: "30/09/2026", closing: 1300 }));
    expect((await statuses(g.client.id, bank.id)).bank?.status).toBe("REVIEW");
    expect(await hasStatementReason(g, bank.label)).toBe(true);
  });
  it("does not assign an undated partial closing to inferred month end", async () => {
    const { g, bank, load } = await setup();
    await load(bca([receipt("15/08/2026", 100, 1100), receipt("25/08/2026", 200, 1300, "CUSTOMER B")], { closing: 1300 }));
    await load(Buffer.from("Tanggal;Keterangan;Debet;Kredit;Saldo\n01/08/2026;SALDO AWAL;;;1000\n15/08/2026;CUSTOMER A;;100;1100\n15/08/2026;SALDO AKHIR;;;1100\n"), "partial.csv");
    const status = await statuses(g.client.id, bank.id);
    expect(status.bank?.status).toBe("REVIEW");
    expect(status.continuity?.status).toBe("REVIEW");
  });

});
