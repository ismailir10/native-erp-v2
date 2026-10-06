import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { managementSummary } from "@/lib/reports/management";
import { managementWorkbook } from "@/lib/reports/management-pack";
import { dateOnly } from "@/lib/format";

// Laporan manajemen bulanan (I4b): figures against last month, movers from the flux scan, and the workbook built from them.
type G = Awaited<ReturnType<typeof makeGroup>>;
let g: G;
const code = async (c: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code: c } })).id;
const post = async (month: number, debit: string, credit: string, amount: bigint) =>
  db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, month, 15), kind: "ADJUSTMENT", memo: "uji", lines: [{ accountId: await code(debit), debit: amount }, { accountId: await code(credit), credit: amount }] }));

beforeEach(async () => {
  await resetDb();
  g = await makeGroup();
  for (const m of [5, 6, 7]) {
    await post(m, "1120", "4100", 100_000_000n);
    await post(m, "6190", "1120", 10_000_000n);
  }
  await post(8, "1120", "4100", 120_000_000n);
  await post(8, "6190", "1120", 40_000_000n); // four times the usual
});

describe("managementSummary", () => {
  it("this month against last month and the year, cash, and the flagged mover", async () => {
    const s = await managementSummary(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month: 8 });
    expect(s.month).toMatchObject({ revenue: 120_000_000n, netProfit: 80_000_000n });
    expect(s.last).toMatchObject({ revenue: 100_000_000n, netProfit: 90_000_000n });
    expect(s.ytd.revenue).toBe(420_000_000n);
    expect(s.month.cash - s.last.cash).toBe(80_000_000n);
    expect(s.movers.map((m) => m.code)).toContain("6190");
    expect(s.changes[0]).toMatchObject({ code: "6190", current: 40_000_000n, average: 10_000_000n, delta: 30_000_000n });
  });
});

describe("managementWorkbook", () => {
  it("opens on Ringkasan with the commentary, and lists Perubahan Akun", async () => {
    const buf = await managementWorkbook(db, { clientId: g.client.id, entityId: g.pt.entity.id, year: 2026, month: 8, meta: { firm: "KJA Uji", title: "PT Uji Sejahtera" } });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Ringkasan", "Perubahan Akun"]);
    const text = wb.getWorksheet("Ringkasan")!.getSheetValues().flat().filter((v) => typeof v === "string").join("\n");
    expect(text).toContain("Pendapatan Agustus 2026 Rp 120.000.000, naik Rp 20.000.000 (20,0 %) dari Juli 2026.");
    expect(text).toMatch(/6190 .*lebih tinggi Rp 30\.000\.000/);
  });
});
