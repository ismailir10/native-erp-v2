import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { balanceSheet, incomeStatement } from "@/lib/reports/ledger";
import { balanceItems, incomeItems, loadReportFormat, renderFormat, standardFormat } from "@/lib/reports/format";
import { dateOnly } from "@/lib/format";
import { financialStatementsWorkbook } from "@/lib/reports/workbook";
import ExcelJS from "exceljs";

/** UC-K3: the format renders the GL's own statements; its totals are the statements' totals, whatever the client calls them. */
describe("report format over the books", () => {
  beforeEach(resetDb);

  it("the standard and a client's format give the GL's net profit and Neraca totals; each client keeps its own", async () => {
    const g = await makeGroup();
    const acc = async (code: string) => (await db.account.findUniqueOrThrow({ where: { clientId_code: { clientId: g.client.id, code } } })).id;
    await db.$transaction(async (tx) => {
      const post = async (lines: [string, bigint, bigint][]) =>
        postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 3, 15), kind: "ADJUSTMENT", memo: "uji", lines: await Promise.all(lines.map(async ([c, d, k]) => ({ accountId: await acc(c), debit: d, credit: k }))) });
      await post([["1110", 10_000_000n, 0n], ["3100", 0n, 10_000_000n]]);
      await post([["1130", 5_000_000n, 0n], ["4100", 0n, 5_000_000n]]);
      await post([["5100", 2_000_000n, 0n], ["1110", 0n, 2_000_000n]]);
      await post([["6190", 700_000n, 0n], ["1110", 0n, 700_000n]]);
    });
    const scope = { clientId: g.client.id, entityIds: [g.pt.entity.id] };
    const is = await incomeStatement(db, scope, dateOnly(2026, 1, 1), dateOnly(2026, 3, 31));
    const bs = await balanceSheet(db, scope, dateOnly(2026, 3, 31));
    const last = (sections: ReturnType<typeof renderFormat>, label: string) => sections.find((s) => s.total?.label === label)!.total!.values[0];

    const standard = await loadReportFormat(db, g.client.id);
    expect(standard.custom).toBe(false);
    const pl = renderFormat(standard.labaRugi, [incomeItems(is)]);
    expect(last(pl, "Laba bersih")).toBe(is.totals.netProfit);
    const nr = renderFormat(standard.neraca, [balanceItems(bs)]);
    expect([last(nr, "Total aset"), last(nr, "Total liabilitas & ekuitas")]).toEqual([bs.totals.assets, bs.totals.liabilities + bs.totals.equity]);

    const mine = standardFormat();
    mine.source = "Laporan Keuangan 2025 final";
    mine.labaRugi = mine.labaRugi.map((l) => (l.key === "hpp" ? { ...l, label: "Harga Pokok Penjualan" } : l.key === "laba_bersih" ? { ...l, label: "LABA BERSIH TAHUN BERJALAN", caps: true } : l));
    await db.reportFormat.create({ data: { firmId: g.firm.id, clientId: g.client.id, format: mine } });
    const custom = await loadReportFormat(db, g.client.id);
    expect([custom.custom, custom.source]).toEqual([true, "Laporan Keuangan 2025 final"]);
    const rendered = renderFormat(custom.labaRugi, [incomeItems(is)]);
    expect(rendered.flatMap((s) => s.items[0]).find((i) => i.fsLine === "hpp")!.label).toBe("Harga Pokok Penjualan");
    expect(last(rendered, "LABA BERSIH TAHUN BERJALAN")).toBe(3_000_000n - 700_000n);

    const other = await makeGroup();
    expect((await loadReportFormat(db, other.client.id)).custom).toBe(false);
  });

  it("the Excel file follows the client's format: its labels in order, totals as formulas over the rows they sum, the unit row", async () => {
    const g = await makeGroup();
    const acc = async (code: string) => (await db.account.findUniqueOrThrow({ where: { clientId_code: { clientId: g.client.id, code } } })).id;
    await db.$transaction(async (tx) => {
      const post = async (lines: [string, bigint, bigint][]) =>
        postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 3, 15), kind: "ADJUSTMENT", memo: "uji", lines: await Promise.all(lines.map(async ([c, d, k]) => ({ accountId: await acc(c), debit: d, credit: k }))) });
      await post([["1110", 10_000_400n, 0n], ["3100", 0n, 10_000_400n]]);
      await post([["1130", 5_000_000n, 0n], ["4100", 0n, 5_000_000n]]);
      await post([["5100", 2_000_000n, 0n], ["1110", 0n, 2_000_000n]]);
      await post([["6190", 700_000n, 0n], ["1110", 0n, 700_000n]]);
    });
    const mine = standardFormat();
    mine.unit = "RIBUAN";
    mine.labaRugi = mine.labaRugi.map((l) => (l.key === "hpp" ? { ...l, label: "Harga Pokok Penjualan" } : l.key === "laba_bersih" ? { ...l, label: "Laba bersih tahun berjalan", caps: true } : l));
    await db.reportFormat.create({ data: { firmId: g.firm.id, clientId: g.client.id, format: mine } });
    const scope = { clientId: g.client.id, entityIds: [g.pt.entity.id] };
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await financialStatementsWorkbook(db, scope, 2026, 3, { firm: "KJA Uji", title: "PT Uji" })) as unknown as ArrayBuffer);

    const rows = (name: string) => {
      const out: { n: number; label: string; cells: ExcelJS.Cell[] }[] = [];
      wb.getWorksheet(name)!.eachRow((r, n) => out.push({ n, label: String(r.getCell(1).value ?? "").trim(), cells: [r.getCell(2), r.getCell(3)] }));
      return out;
    };
    // ExcelJS leaves a cached result of 0 out of the file (the workbook sets fullCalcOnLoad, so Excel recalculates on open).
    const value = (c: ExcelJS.Cell): number => (c.value && typeof c.value === "object" && "formula" in c.value ? Number(c.value.result ?? 0) : Number(c.value ?? 0));
    // Every formula, worked out from the cells it names, gives its own cached result: the file recalculates to the same figures.
    const checkFormulas = (name: string) => {
      const ws = wb.getWorksheet(name)!;
      let count = 0;
      for (const r of rows(name))
        for (const c of r.cells) {
          if (!(c.value && typeof c.value === "object" && "formula" in c.value)) continue;
          count++;
          const sum = [...String(c.value.formula).matchAll(/([+-]?)([A-Z])(\d+)/g)].reduce((s, [, sign, col, row]) => s + (sign === "-" ? -1 : 1) * value(ws.getCell(`${col}${row}`)), 0);
          expect(sum, `${name} ${c.address} = ${c.value.formula}`).toBe(Number(c.value.result ?? 0));
        }
      return count;
    };
    expect(checkFormulas("Laba Rugi")).toBeGreaterThan(0);
    expect(checkFormulas("Neraca")).toBeGreaterThan(0);

    const lr = rows("Laba Rugi");
    expect(lr.map((r) => r.label)).toContain("Dinyatakan dalam ribuan Rupiah");
    const order = ["Pendapatan usaha", "Total pendapatan usaha", "Harga Pokok Penjualan", "Laba kotor", "LABA BERSIH TAHUN BERJALAN"];
    const at = order.map((l) => lr.findIndex((r) => r.label === l));
    expect(at.every((i) => i >= 0) && at.every((i, k) => k === 0 || i > at[k - 1]), JSON.stringify(at)).toBe(true);
    const net = lr.find((r) => r.label === "LABA BERSIH TAHUN BERJALAN")!;
    expect(value(net.cells[0])).toBe(2_300_000);
    // Thousands are a display format over exact Rupiah, so the formulas stay exact.
    expect(net.cells[0].numFmt).toBe('#,##0,;(#,##0,);"–"');
    const nr = rows("Neraca");
    expect([value(nr.find((r) => r.label === "Total aset")!.cells[0]), value(nr.find((r) => r.label === "Total liabilitas & ekuitas")!.cells[0])]).toEqual([12_300_400, 12_300_400]);
  });
});
