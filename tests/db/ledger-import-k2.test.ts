import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { db, makeGroup, resetDb } from "../helpers";
import { acceptCheck, importSourceAccounts, postImport, stageImport } from "@/lib/ledger-import/post";
import { acceptMappings } from "@/lib/ledger-import/mapping";
import { postOpening } from "@/lib/opening";
import { dateOnly } from "@/lib/format";

/** UC-K2 / UC-B4: a GL file is checked against the books it lands in. */
type Row = [string, string, string, number, number];
async function gl(rows: Row[], header = ["Tanggal", "Kode Akun", "Nama Akun", "Debit", "Kredit"]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("GL");
  ws.addRow(header);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const pair = (date: string, amount: number): Row[] => [[date, "10-100", "Kas Kecil", amount, 0], [date, "40-100", "Penjualan", 0, amount]];

async function stage(g: Awaited<ReturnType<typeof makeGroup>>, fileName: string, data: Buffer) {
  const st = await stageImport(db, { firmId: g.firm.id, clientId: g.client.id, fileName, data, entityId: g.pt.entity.id });
  if (st.status !== "STAGED") throw new Error("not staged");
  return st;
}
async function post(g: Awaited<ReturnType<typeof makeGroup>>, importId: string) {
  const src = await importSourceAccounts(db, importId);
  await acceptMappings(db, g.client.id, src.map((s) => ({ sourceAccountId: s.id, accountCode: s.code === "10-100" ? "1110" : "4100", method: "MANUAL" as const })));
  return postImport(db, g.client.id, importId);
}

describe("GL import against the books (UC-K2, UC-B4)", () => {
  beforeEach(resetDb);

  it("without Saldo Awal says so and names both ways in; stores a header typo as INFO", async () => {
    const g = await makeGroup();
    const st = await stage(g, "gl.xlsx", await gl([...pair("15/02/2023", 100), ...pair("15/03/2023", 50)], ["Tanggal", "Kode Akun", "Nama Akun", "Debet", "Kredti"]));
    const checks = await db.importCheck.findMany({ where: { ledgerImportId: st.importId }, orderBy: { code: "asc" } });
    expect(checks.find((c) => c.code === "NO_OPENING")).toMatchObject({ severity: "INFO", message: expect.stringContaining("mulai 15 Feb 2023") });
    expect(checks.find((c) => c.code === "NO_OPENING")!.message).toContain("Neraca per 14 Feb 2023 sebagai Saldo Awal, atau Neraca per tanggal sesudahnya");
    expect(checks.find((c) => c.code === "HEADER_TYPO")).toMatchObject({ severity: "INFO", message: 'Kolom "Kredti" dibaca sebagai Kredit (salah ketik di judul kolom).', refs: ["GL!E1"] });
  });

  it("refuses rows on or before Saldo Awal: they are already in it", async () => {
    const g = await makeGroup();
    await postOpening(db, { clientId: g.client.id, entityId: g.pt.entity.id, date: dateOnly(2026, 1, 31), lines: [{ accountCode: "1110", debit: "1000", credit: "" }, { accountCode: "3100", debit: "", credit: "1000" }] });
    const st = await stage(g, "gl.xlsx", await gl([...pair("31/01/2026", 100), ...pair("15/02/2026", 50)]));
    const block = (await db.importCheck.findMany({ where: { ledgerImportId: st.importId, code: "BEFORE_OPENING" } }))[0];
    expect(block).toMatchObject({ severity: "BLOCK", refs: ["GL!2", "GL!3"] });
    expect(block.message).toMatch(/^PT Uji: 1 jurnal bertanggal s\.d\. 31 Jan 2026, tanggal Saldo Awal\. .*Impor buku besar mulai 1 Feb 2026/);
    await expect(acceptCheck(db, g.client.id, block.id)).rejects.toThrow(/Hanya jurnal tidak seimbang atau tanggal salah ketik/);
    await expect(post(g, st.importId)).rejects.toThrow(/masalah BLOCK/);
  });

  it("names the months missing between this file and the GL already posted", async () => {
    const g = await makeGroup();
    const jan = await stage(g, "jan.xlsx", await gl(pair("31/01/2026", 100)));
    await post(g, jan.importId);
    const apr = await stage(g, "apr.xlsx", await gl(pair("30/04/2026", 100)));
    const gap = (await db.importCheck.findMany({ where: { ledgerImportId: apr.importId, code: "MISSING_MONTH" } }))[0];
    expect(gap.message).toBe("PT Uji: buku besar Februari 2026, Maret 2026 belum ada di antara file ini dan buku besar yang sudah dicatat sebelumnya (31 Jan 2026).");
  });

  it("posts an accepted year typo on the corrected date", async () => {
    const g = await makeGroup();
    const rows = [...pair("10/01/2026", 10), ...pair("10/02/2026", 10), ...pair("10/03/2026", 10), ...pair("10/04/2026", 10), ...pair("10/05/2026", 10), ...pair("10/06/2026", 10), ...pair("05/03/2023", 70)];
    const st = await stage(g, "gl.xlsx", await gl(rows));
    const typos = await db.importCheck.findMany({ where: { ledgerImportId: st.importId, code: "DATE_TYPO" } });
    expect(typos).toHaveLength(2);
    for (const t of typos) await acceptCheck(db, g.client.id, t.id);
    await post(g, st.importId);
    const e = await db.journalEntry.findFirstOrThrow({ where: { ledgerImportId: st.importId, lines: { some: { debit: 70n } } }, include: { lines: true } });
    expect(e.date).toEqual(dateOnly(2026, 3, 5));
    expect(e.lines.map((l) => l.memo)).toEqual(["tanggal di file 5 Mar 2023", "tanggal di file 5 Mar 2023"]);
    expect(await db.ledgerImport.findUniqueOrThrow({ where: { id: st.importId } })).toMatchObject({ periodStart: dateOnly(2026, 1, 10), periodEnd: dateOnly(2026, 6, 10) });
  });
});
