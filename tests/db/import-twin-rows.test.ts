import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { importStatement } from "@/lib/import/pipeline";

// A statement that prints no running balance (only an opening row): nothing tells two identical same-day lines apart but their order.
const file = (...rows: string[]) => Buffer.from(["Tanggal;Keterangan;Debet;Kredit;Saldo", "01/08/2026;SALDO AWAL;;;100.000.000,00", ...rows, ""].join("\n"));
const fees = ["02/08/2026;BIAYA ADM;15.000,00;0,00;", "02/08/2026;BIAYA ADM;15.000,00;0,00;"];
const receipt = "03/08/2026;TRSF MASUK PT X;0,00;1.000.000,00;";

describe("identical lines in one statement without a running balance", () => {
  beforeEach(resetDb);

  it("keeps both (two Rp 15.000 fees on one day are two bank lines), instead of failing the whole import", async () => {
    const g = await makeGroup();
    const summary = await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "cms-agu.csv", data: file(...fees, receipt), provider: null });
    expect(summary.rows).toBe(3);
    expect(summary.duplicates).toBe(0);
    const stored = await db.bankTransaction.findMany({ where: { bankAccountId: g.pt.banks[0].id }, orderBy: { rowNumber: "asc" } });
    expect(stored.filter((t) => t.description === "BIAYA ADM")).toHaveLength(2);
    expect(stored.reduce((s, t) => s + t.amount, 0n)).toBe(-15_000n - 15_000n + 1_000_000n);
    expect(new Set(stored.map((t) => t.hash)).size).toBe(3);
  });

  it("the same file again adds nothing: the twins pair one to one", async () => {
    const g = await makeGroup();
    const args = { bankAccountId: g.pt.banks[0].id, fileName: "cms-agu.csv", data: file(...fees, receipt), provider: null };
    await importStatement(db, args);
    const again = await importStatement(db, args);
    expect(again.rows - again.duplicates).toBe(0);
    expect(await db.bankTransaction.count({ where: { bankAccountId: g.pt.banks[0].id } })).toBe(3);
  });

  it("a changed overlapping file without balance evidence is refused without altering its twins", async () => {
    const g = await makeGroup();
    await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "cms-agu.csv", data: file(...fees, receipt), provider: null });
    const journals = await db.journalEntry.count();
    await expect(importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "cms-agu-penuh.csv", data: file(...fees, receipt, "10/08/2026;TARIKAN TUNAI;500.000,00;0,00;"), provider: null })).rejects.toThrow(/saldo tidak membuktikan identitasnya/);
    expect(await db.bankTransaction.count({ where: { bankAccountId: g.pt.banks[0].id } })).toBe(3);
    expect(await db.journalEntry.count()).toBe(journals);
  });
});

describe("a line that moves no money (BUG-009)", () => {
  beforeEach(resetDb);
  // BRI internet-banking CSV keeps a 0,00 / 0,00 line (the generic reader already drops them).
  const bri = (number: string, ...rows: string[]) => Buffer.from([`NOREK;${number}`, "NAMA;PT UJI", "TGL_TRAN;DESK_TRAN;MUTASI_DEBET;MUTASI_KREDIT;SALDO_AKHIR_MUTASI", ...rows, ""].join("\n"));

  it("is left out with a note naming its row; the other lines import", async () => {
    const g = await makeGroup();
    const bank = g.pt.banks[0];
    const data = bri(bank.number, "2026-08-02;BIAYA NOL;0.00;0.00;100000000.00", "2026-08-03;TRSF MASUK PT X;0.00;1000000.00;101000000.00");
    const summary = await importStatement(db, { bankAccountId: bank.id, fileName: "bri.csv", data, provider: null });
    expect(summary.rows).toBe(1);
    expect(summary.notes.join(" ")).toMatch(/1 baris bernilai nol dilewati \(baris 4\)/);
    expect(await db.bankTransaction.count({ where: { bankAccountId: bank.id } })).toBe(1);
  });

  it("a file of only zero lines says so", async () => {
    const g = await makeGroup();
    const bank = g.pt.banks[0];
    await expect(importStatement(db, { bankAccountId: bank.id, fileName: "bri.csv", data: bri(bank.number, "2026-08-02;BIAYA NOL;0.00;0.00;100000000.00"), provider: null })).rejects.toThrow("semua baris berjumlah nol");
  });
});

describe("an amount beyond any real account (BUG-010)", () => {
  beforeEach(resetDb);

  it("is refused with its row, not left to fail at the database", async () => {
    const g = await makeGroup();
    const bank = g.pt.banks[0];
    const data = Buffer.from([`NOREK;${bank.number}`, "NAMA;PT UJI", "TGL_TRAN;DESK_TRAN;MUTASI_DEBET;MUTASI_KREDIT;SALDO_AKHIR_MUTASI", "2026-05-02;SETORAN RAKSASA;0.00;99999999999999999999.00;99999999999999999999.00", ""].join("\n"));
    await expect(importStatement(db, { bankAccountId: bank.id, fileName: "bri.csv", data, provider: null })).rejects.toThrow(/Nominal terlalu besar di baris 4/);
    expect(await db.bankTransaction.count()).toBe(0);
  });
});

describe("a statement date nowhere near the present is refused (BUG-002)", () => {
  beforeEach(resetDb);

  it("names the row and the date", async () => {
    const g = await makeGroup();
    const data = Buffer.from(["Tanggal;Keterangan;Debet;Kredit;Saldo", "18/07/1905;SETORAN;0,00;2.500.000,00;102.500.000,00", ""].join("\n"));
    await expect(importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "x.csv", data, provider: null })).rejects.toThrow(/tidak masuk akal: 18 Jul 1905/);
  });
});
