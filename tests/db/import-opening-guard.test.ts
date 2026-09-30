import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { importStatement } from "@/lib/import/pipeline";
import { postOpening } from "@/lib/opening";
import { dateOnly } from "@/lib/format";

const csv = (...rows: string[]) => Buffer.from(["Tanggal;Keterangan;Debet;Kredit;Saldo", ...rows, ""].join("\n"));
const opening = (g: Awaited<ReturnType<typeof makeGroup>>, date = dateOnly(2026, 7, 31)) =>
  postOpening(db, { clientId: g.client.id, entityId: g.pt.entity.id, date, lines: [{ accountCode: "1101", debit: "100000000", credit: "0" }] });

describe("statement rows before Saldo Awal", () => {
  beforeEach(resetDb);

  it("refuses new rows dated on or before the opening, saying which and what to do, and imports nothing", async () => {
    const g = await makeGroup();
    await opening(g);
    const file = csv("15/07/2026;TRSF CR TOKO;0;5000000;105000000", "31/07/2026;BIAYA ADM;15000;0;104985000", "05/08/2026;TRSF CR TOKO;0;1000000;105985000");
    await expect(importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca-jul.csv", data: file, provider: null })).rejects.toThrow(
      "Saldo awal PT Uji dicatat per 31 Jul 2026, sudah termasuk transaksi sampai tanggal itu. File ini berisi 2 transaksi bertanggal sampai 31 Jul 2026 (paling awal 15 Jul 2026). Pilih file yang mulai setelah tanggal itu, atau koreksi saldo awal lewat Jurnal Penyesuaian.",
    );
    expect(await db.bankTransaction.count()).toBe(0);
    expect(await db.statementImport.count()).toBe(0);
  });

  it("imports a statement that starts after the opening", async () => {
    const g = await makeGroup();
    await opening(g);
    const summary = await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca-agu.csv", data: csv("05/08/2026;TRSF CR TOKO;0;1000000;101000000"), provider: null });
    expect(summary.rows - summary.duplicates).toBe(1);
  });

  it("only guards the entity that has the opening, and never blocks a statement that was already imported", async () => {
    const g = await makeGroup();
    // The owner has no opening: an old statement imports fine.
    await importStatement(db, { bankAccountId: g.owner.banks[0].id, fileName: "bri-jun.csv", data: csv("10/06/2026;TRSF CR;0;1000;1001000"), provider: null });
    expect(await db.bankTransaction.count({ where: { entityId: g.owner.entity.id } })).toBe(1);
    // The PT imports August, then its opening is recorded before that (as the form requires); re-importing August is a no-op, not a refusal.
    const aug = csv("05/08/2026;TRSF CR TOKO;0;1000000;101000000");
    await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca-agu.csv", data: aug, provider: null });
    await opening(g);
    const again = await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca-agu.csv", data: aug, provider: null });
    expect(again.duplicates).toBe(1);
  });
});
