import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { balanceSheet, incomeStatement } from "@/lib/reports/ledger";
import { balanceItems, incomeItems, loadReportFormat, renderFormat, standardFormat } from "@/lib/reports/format";
import { dateOnly } from "@/lib/format";

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
});
