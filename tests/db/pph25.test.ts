import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { db, makeGroup, resetDb } from "../helpers";
import { importStatement } from "@/lib/import/pipeline";
import { dateOnly } from "@/lib/format";
import { masaReport, pph25Notes } from "@/lib/tax/masa-report";
import { masaWorkbook } from "@/lib/tax/masa-workbook";
import { deleteInstalment, setInstalment } from "@/lib/tax/instalment";
import { runControls } from "@/lib/controls";

// PPh 25 angsuran on Pajak Masa (rule 5j): the masa due in the report month judged on its bank lines against the instalment in force.
type G = Awaited<ReturnType<typeof makeGroup>>;
let g: G;

beforeEach(async () => {
  await resetDb();
  g = await makeGroup();
});

const d = (m: number, day: number) => dateOnly(2026, m, day);
async function pay(...rows: [string, string, number][]) {
  let saldo = 500_000_000;
  const lines = ["Tanggal;Keterangan;Debet;Kredit;Saldo", `01/08/2026;SALDO AWAL;;;${saldo}`];
  for (const [date, memo, amount] of rows) {
    saldo -= amount;
    lines.push(`${date};${memo};${amount};0;${saldo}`);
  }
  await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca.csv", data: Buffer.from([...lines, ""].join("\n")), provider: null });
}
const set = (from: string, amount: string) => setInstalment(db, { clientId: g.client.id, entityId: g.pt.entity.id, from, amount });
const report = (now: Date) => masaReport(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month: 8, now }).then((r) => r!);
const control = async () => (await runControls(db, g.client.id, 2026, 8)).find((c) => c.key === `masa:${g.pt.entity.id}`);

describe("PPh 25 on Pajak Masa", () => {
  it("is absent with no instalment and no payment; once set, a July instalment unpaid by 15 August is short, and the close flags it", async () => {
    expect((await report(d(9, 1))).pph25).toBeNull();
    expect(await control()).toBeUndefined();

    await set("2026-04", "5.000.000");
    const r = await report(d(9, 1));
    expect(r.pph25).toMatchObject({
      previous: { masa: { year: 2026, month: 7 }, expected: 5_000_000n, due: d(8, 15), short: 5_000_000n, state: "KURANG" },
      current: { masa: { year: 2026, month: 8 }, expected: 5_000_000n, due: d(9, 15), paid: [] },
      status: "REVIEW",
    });
    expect(pph25Notes(r.pph25!)[0]).toBe("Masa Juli 2026: Rp 5.000.000 dari angsuran Rp 5.000.000 belum disetor sampai jatuh tempo 15 Agu 2026.");
    expect(await control()).toMatchObject({ status: "REVIEW", detail: "PPh 25: Masa Juli 2026: Rp 5.000.000 dari angsuran Rp 5.000.000 belum disetor sampai jatuh tempo 15 Agu 2026." });
    // Before the 15th it is not late yet.
    expect((await report(d(8, 10))).pph25).toMatchObject({ previous: { state: "BELUM_JATUH_TEMPO" }, status: "PASS" });
  });

  it("passes the instalment paid by the 15th (masa = the month before payment), and the Excel carries the row", async () => {
    await set("2026-01", "5.000.000");
    await pay(["14/08/2026", "SETORAN PPH 25 MASA JULI", 5_000_000]);
    const r = await report(d(9, 1));
    expect(r.pph25).toMatchObject({ previous: { state: "LUNAS", short: 0n, paid: [{ date: d(8, 14), amount: 5_000_000n }] }, status: "PASS" });
    expect(pph25Notes(r.pph25!)).toEqual([]);
    expect(await control()).toMatchObject({ status: "PASS", detail: "Masa Juli 2026 disetor penuh sampai jatuh tempo; saldo PPh 25 sesuai yang masih terutang" });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await masaWorkbook(r, { firm: "KJA Uji", title: "PT Uji" })) as unknown as ArrayBuffer);
    const row = wb.getWorksheet("Ringkasan")!.getSheetValues().find((v) => Array.isArray(v) && v[1] === "PPh 25 (angsuran)") as unknown[];
    expect(row.slice(1, 9)).toEqual(["PPh 25 (angsuran)", 5_000_000, "15 Sep 2026", 5_000_000, 5_000_000, 0, "", "Lolos · Lunas"]);
  });

  it("names a payment after the 15th as late, and judges each masa on the instalment in force for it", async () => {
    await set("2026-04", "5.000.000");
    await set("2026-08", "6.500.000");
    await pay(["20/08/2026", "SETORAN PPH 25", 5_000_000]);
    const r = await report(d(9, 1));
    expect(r.pph25).toMatchObject({ previous: { expected: 5_000_000n, state: "TERLAMBAT", late: [{ date: d(8, 20), amount: 5_000_000n }] }, current: { expected: 6_500_000n }, instalment: { amount: 6_500_000n }, status: "REVIEW" });
    expect(pph25Notes(r.pph25!)[0]).toBe("Masa Juli 2026: angsuran disetor setelah jatuh tempo 15 Agu 2026 (20 Agu 2026 Rp 5.000.000).");
  });

  it("asks for the instalment when PPh 25 was paid without one; nothing under PP 55; changes are audited", async () => {
    await pay(["15/08/2026", "SETORAN PPH 25", 4_000_000]);
    const r = await report(d(9, 1));
    expect(r.pph25).toMatchObject({ previous: { expected: null, state: "DISETOR" }, instalment: null, status: "PASS" });
    expect(pph25Notes(r.pph25!)).toEqual(["Angsuran PPh 25 per bulan belum diisi: isi dari SPT tahunan terakhir supaya setorannya bisa dicek."]);

    const row = await set("2026-07", "4.000.000");
    expect((await report(d(9, 1))).pph25).toMatchObject({ previous: { state: "LUNAS" } });
    await set("2026-07", "4.500.000");
    await deleteInstalment(db, { clientId: g.client.id, id: row.id });
    expect((await db.auditEvent.findMany({ where: { kind: "PPH25" }, orderBy: { createdAt: "asc" } })).map((a) => a.summary)).toEqual([
      "Angsuran PPh 25 PT Uji mulai masa Juli 2026: Rp 4.000.000",
      "Angsuran PPh 25 PT Uji mulai masa Juli 2026: Rp 4.500.000 (sebelumnya Rp 4.000.000)",
      "Angsuran PPh 25 PT Uji mulai masa Juli 2026 dihapus (Rp 4.500.000)",
    ]);

    await db.taxYear.create({ data: { firmId: g.firm.id, clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, regime: "FINAL_UMKM" } });
    expect((await report(d(9, 1))).pph25).toBeNull();
  });

  it("refuses an individual's books, a blank amount and a negative one", async () => {
    await expect(setInstalment(db, { clientId: g.client.id, entityId: g.owner.entity.id, from: "2026-08", amount: "1.000" })).rejects.toThrow("Angsuran PPh 25 hanya untuk badan usaha (PT/CV) dengan pembukuan Rupiah.");
    await expect(set("2026-08", " ")).rejects.toThrow("Isi angsuran PPh 25 per bulan. Isi 0 untuk nihil.");
    await expect(set("2026-08", "-5.000")).rejects.toThrow("Angsuran PPh 25 tidak boleh negatif. Isi 0 untuk nihil.");
    await expect(set("2026-13", "5.000")).rejects.toThrow("Pilih masa mulai berlakunya angsuran.");
  });
});
