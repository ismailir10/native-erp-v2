import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { importStatement } from "@/lib/import/pipeline";
import { taxPack } from "@/lib/tax/pack";
import { setTaxMonth } from "@/lib/tax/records";
import { defaultTaxMonth } from "@/lib/tax/masa";
import { reviewTransaction } from "@/lib/review";
import { dateOnly } from "@/lib/format";
import { taxWorkpaper } from "@/lib/tax/workpaper";
import ExcelJS from "exceljs";

type G = Awaited<ReturnType<typeof makeGroup>>;

/** PT Uji pays PPh 25 of 1 jt on the 14th for the month before: Feb 2026 for January … 14 January 2027 for December 2026. */
async function instalments(g: G) {
  const rows = ["14/02/2026", "14/03/2026", "14/04/2026", "14/05/2026", "14/06/2026", "14/07/2026", "14/08/2026", "14/09/2026", "14/10/2026", "14/11/2026", "14/12/2026", "14/01/2027"];
  const csv = ["Tanggal;Keterangan;Debet;Kredit;Saldo", ...rows.map((d, i) => `${d};SETORAN PPH 25 ANGSURAN ${i + 1};1000000;0;${99_000_000 - i * 1_000_000}`), ""].join("\n");
  await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca.csv", data: Buffer.from(csv), provider: null });
}
const pph25 = async (year: number, month: number, g: G) => (await taxPack(db, g.client.id, g.pt.entity.id, year, month))!.credits.filter((c) => c.type === "PPH_25");

describe("PPh 25 by masa pajak", () => {
  beforeEach(resetDb);

  it("defaults the tax month to the month before payment", () => {
    expect(defaultTaxMonth(dateOnly(2027, 1, 14)).toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(defaultTaxMonth(dateOnly(2026, 6, 15)).toISOString().slice(0, 10)).toBe("2026-05-01");
  });

  it("credits year Y with twelve instalments when December is paid on 14 January Y+1; the next year's pack excludes it", async () => {
    const g = await makeGroup();
    await instalments(g);
    const december = await db.bankTransaction.findFirstOrThrow({ where: { description: { contains: "ANGSURAN 12" } } });
    expect(december.taxMonth?.toISOString().slice(0, 10)).toBe("2026-12-01"); // stored when it was classified
    const y = await pph25(2026, 12, g);
    expect(y).toHaveLength(12);
    expect(y.reduce((t, c) => t + c.amount, 0n)).toBe(12_000_000n);
    expect(y.at(-1)!.masa?.toISOString().slice(0, 10)).toBe("2026-12-01");
    // Through November the pack has the eleven instalments of masa Jan–Nov, and never the one paid after.
    expect(await pph25(2026, 11, g)).toHaveLength(11);
    // 2027: nothing (the January payment belongs to 2026).
    expect(await pph25(2027, 1, g)).toHaveLength(0);
    expect(await pph25(2027, 12, g)).toHaveLength(0);
  });

  it("prints the masa pajak of each PPh 25 instalment in the kertas kerja", async () => {
    const g = await makeGroup();
    await instalments(g);
    const pack = (await taxPack(db, g.client.id, g.pt.entity.id, 2026, 12))!;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await taxWorkpaper(db, pack, { firm: "KJA Uji", client: "Grup Uji", npwp: null })) as unknown as ArrayBuffer);
    const rows: string[][] = [];
    wb.getWorksheet("Kredit Pajak")!.eachRow((r) => { if (r.getCell(1).value === "PPh 25") rows.push([String(r.getCell(3).value), String(r.getCell(7).value)]); });
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual(["SETORAN PPH 25 ANGSURAN 1", "Januari 2026"]); // paid 14 February
    expect(rows[11]).toEqual(["SETORAN PPH 25 ANGSURAN 12", "Desember 2026"]); // paid 14 January 2027
  });

  it("keeps a line booked before tax months existed on its bank date, and lets the accountant set the masa", async () => {
    const g = await makeGroup();
    await instalments(g);
    const december = await db.bankTransaction.findFirstOrThrow({ where: { description: { contains: "ANGSURAN 12" } } });
    await db.bankTransaction.update({ where: { id: december.id }, data: { taxMonth: null } }); // legacy row
    expect(await pph25(2026, 12, g)).toHaveLength(11);
    expect(await pph25(2027, 1, g)).toHaveLength(1);
    await setTaxMonth(db, { clientId: g.client.id, bankTransactionId: december.id, month: "2026-12" });
    expect(await pph25(2026, 12, g)).toHaveLength(12);
    expect(await pph25(2027, 1, g)).toHaveLength(0);
    await expect(setTaxMonth(db, { clientId: g.client.id, bankTransactionId: december.id, month: "2027-02" })).rejects.toThrow(/setelah bulan pembayaran/);
    await expect(setTaxMonth(db, { clientId: g.client.id, bankTransactionId: december.id, month: "bukan" })).rejects.toThrow(/Masa pajak/);
    const other = await db.bankTransaction.findFirstOrThrow({ where: { description: { contains: "ANGSURAN 2" } } });
    await reviewTransaction(db, { bankTxId: other.id, accountCode: "6190", taxTag: null }); // no longer PPh 25: no masa
    expect((await db.bankTransaction.findUniqueOrThrow({ where: { id: other.id } })).taxMonth).toBeNull();
    await expect(setTaxMonth(db, { clientId: g.client.id, bankTransactionId: other.id, month: "2026-02" })).rejects.toThrow(/PPh 25/);
  });
});
