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

  it("a longer file overlapping the first adds only its new lines", async () => {
    const g = await makeGroup();
    await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "cms-agu.csv", data: file(...fees, receipt), provider: null });
    const more = await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "cms-agu-penuh.csv", data: file(...fees, receipt, "10/08/2026;TARIKAN TUNAI;500.000,00;0,00;"), provider: null });
    expect(more.rows - more.duplicates).toBe(1);
    expect(await db.bankTransaction.count({ where: { bankAccountId: g.pt.banks[0].id } })).toBe(4);
  });
});
