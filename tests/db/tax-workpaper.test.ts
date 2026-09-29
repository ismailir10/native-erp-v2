import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { taxPack } from "@/lib/tax/pack";
import { taxWorkpaper } from "@/lib/tax/workpaper";
import { acceptSuggestion, addCredit, setLoss } from "@/lib/tax/records";
import { postTax } from "@/lib/tax/post";
import { dateOnly } from "@/lib/format";

type G = Awaited<ReturnType<typeof makeGroup>>;
const acc = async (g: G, code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
const journal = async (g: G, date: Date, dr: string, cr: string, amount: bigint) =>
  db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date, kind: "ADJUSTMENT", memo: "uji", lines: [{ accountId: await acc(g, dr), debit: amount }, { accountId: await acc(g, cr), credit: amount }] }));

describe("tax workpaper", () => {
  beforeEach(resetDb);

  it("writes the pack's figures to its sheets, read back from the .xlsx", async () => {
    const g = await makeGroup();
    await db.account.create({ data: { firmId: g.firm.id, clientId: g.client.id, code: "6197", name: "Beban Pulsa Telepon Seluler", type: "BEBAN", normalBalance: "DEBIT", fsLine: "BEBAN_UMUM_ADM" } });
    await journal(g, dateOnly(2026, 3, 31), "1130", "4100", 1_000_000_000n);
    await journal(g, dateOnly(2026, 4, 30), "6100", "1110", 400_000_000n);
    await journal(g, dateOnly(2026, 4, 30), "6197", "1110", 8_000_000n);
    const base = { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026 };
    await acceptSuggestion(db, { ...base, accountCode: "6197", amount: 8_000_000n });
    await setLoss(db, { ...base, originYear: 2024, amount: "50000000" });
    await addCredit(db, { ...base, type: "PPH_23", reference: "BP-9", date: "2026-05-05", amount: "20000000", accountCode: "1180" });
    await postTax(db, { ...base, month: 9, kind: "CURRENT" });
    const pack = (await taxPack(db, g.client.id, g.pt.entity.id, 2026, 9))!;
    // PBT 592 jt + 4 jt (50% of phones) = 596 jt − 50 jt loss = 546 jt → 11% = 60,06 jt.
    expect(pack.tax).toMatchObject({ pkp: 546_000_000n, due: 60_060_000n });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await taxWorkpaper(db, pack, { firm: "KJA Uji", client: "Grup Uji", npwp: null })) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Rekonsiliasi Fiskal", "Koreksi Fiskal", "Laba Rugi", "Kompensasi Kerugian", "Kredit Pajak", "Pajak Tangguhan", "Jurnal"]);
    const find = (sheet: string, label: string, col = 2) => {
      let v: ExcelJS.CellValue = null;
      wb.getWorksheet(sheet)!.eachRow((r) => { if (String(r.getCell(1).value ?? "").trim() === label) v = r.getCell(col).value; });
      return v;
    };
    expect(find("Rekonsiliasi Fiskal", "Laba sebelum pajak (komersial)")).toBe(592_000_000);
    expect(find("Rekonsiliasi Fiskal", "Kompensasi kerugian")).toBe(-50_000_000);
    expect(find("Rekonsiliasi Fiskal", "Penghasilan kena pajak (dibulatkan ke bawah ribuan)")).toBe(546_000_000);
    expect(find("Rekonsiliasi Fiskal", "PPh badan terutang")).toBe(60_060_000);
    expect(find("Rekonsiliasi Fiskal", "PPh Pasal 29 kurang bayar")).toBe(40_060_000);
    expect(find("Kompensasi Kerugian", "2024", 3)).toBe(50_000_000);
    let phones: ExcelJS.CellValue[] = [];
    wb.getWorksheet("Koreksi Fiskal")!.eachRow((r) => { if (String(r.getCell(1).value).includes("Telepon")) phones = [r.getCell(5).value, r.getCell(8).value]; });
    expect(phones).toEqual([50, 4_000_000]);
    let posted = 0;
    wb.getWorksheet("Jurnal")!.eachRow((r) => { if (r.getCell(1).value === "Dicatat") posted++; });
    expect(posted).toBe(3);
  });
});
