import ExcelJS from "exceljs";

/**
 * The five August 2026 transactions of a made-up company that every synthetic statement fixture lays out (`tests/bank-fixture.ts`,
 * `tests/bank-layouts.ts`, `tests/unknown-layout.ts`). No test-runner import here, so Playwright specs can build files from it too.
 */
export type Tx = { d: number; desc: string[]; amt: number };
export const OPEN = 100_000_000;
export const TX: Tx[] = [
  { d: 1, desc: ["TRSF E-BANKING CR 0108/FTSCY/WS95031", "PT MITRA UNGGAS FIKTIF"], amt: 55_500_000 },
  { d: 2, desc: ["PEMBAYARAN LISTRIK PLN", "TOKEN 0000-1111-2222"], amt: -2_450_000 },
  { d: 5, desc: ["BI-FAST DB 0508 CV CONTOH ABADI"], amt: -15_000_000 },
  { d: 5, desc: ["BUNGA JASA GIRO"], amt: 45_678 },
  { d: 31, desc: ["BIAYA ADM"], amt: -15_000 },
];
export const BAL: number[] = [];
{
  let b = OPEN;
  for (const t of TX) BAL.push((b += t.amt));
}
export const CLOSE = BAL[BAL.length - 1];
export const EXPECT_AMOUNTS = TX.map((t) => BigInt(t.amt));
export const p2 = (n: number) => String(n).padStart(2, "0");
export const EXPECT_DATES = TX.map((t) => `2026-08-${p2(t.d)}`);
/** 1234567 → "1,234,567.00" (en) / "1.234.567,00" (id). */
export const en = (v: number) => Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + ".00";
export const idn = (v: number) => Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + ",00";

export async function xlsxBuffer(sheet: string, rows: (string | number | Date)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
