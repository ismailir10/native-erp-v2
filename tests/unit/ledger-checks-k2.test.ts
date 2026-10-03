import { describe, expect, it } from "vitest";
import { planLedger, type EntityInfo } from "@/lib/ledger-import/check";
import type { LedgerRow } from "@/lib/ledger-import/types";
import { dateOnly } from "@/lib/format";

/** UC-K2 / UC-B1f: what a GL file says about itself is checked, never trusted blind. */
const entities = new Map<string, EntityInfo>([["", { entityId: "e1", name: "PT Uji", currency: "IDR" }]]);
let n = 0;
const row = (date: Date, code: string, debit: bigint, credit: bigint, extra: Partial<LedgerRow> = {}): LedgerRow => ({
  ref: `GL!${++n + 1}`,
  row: n + 1,
  date,
  entity: null,
  code,
  name: code === "1101" ? "Kas" : "Pendapatan",
  debit,
  credit,
  currency: null,
  rate: null,
  description: "",
  voucher: null,
  errors: [],
  ...extra,
});
/** One balanced pair per month given. */
const months = (...ms: [number, number][]) => ms.flatMap(([y, m]) => [row(dateOnly(y, m, 15), "1101", 100_00n, 0n), row(dateOnly(y, m, 15), "4100", 0n, 100_00n)]);
const plan = (rows: LedgerRow[], totals?: Parameters<typeof planLedger>[1]["totals"]) => planLedger(rows, { entities, currencyMode: "FUNCTIONAL", totals });
const codes = (p: ReturnType<typeof plan>) => p.checks.map((c) => c.code);

describe("GL file checks (UC-K2)", () => {
  it("lists rows written negative, posts them on the other side with the same number", () => {
    const p = plan([row(dateOnly(2026, 1, 5), "1101", 0n, 500_00n, { negative: true, raw: { debit: -500_00n, credit: 0n } }), row(dateOnly(2026, 1, 5), "4100", 0n, 0n, { negative: false }), row(dateOnly(2026, 1, 5), "4100", 500_00n, 0n)]);
    const neg = p.checks.find((c) => c.code === "NEGATIVE_AMOUNT")!;
    expect(neg).toMatchObject({ severity: "REVIEW", refs: [expect.stringMatching(/^GL!/)] });
    expect(neg.message).toMatch(/^1 baris menulis angka negatif/);
    expect(p.entries[0].lines.find((l) => l.code === "1101")!.amount).toBe(-500n);
  });

  it("ties the file's grand total to its rows as written, and says when it doesn't", () => {
    const rows = months([2026, 1], [2026, 2]);
    expect(plan(rows, [{ ref: "GL!9", label: "Total", debit: 200_00n, credit: 200_00n }]).checks.find((c) => c.code === "TOTAL_OK")).toMatchObject({ severity: "INFO", refs: ["GL!9"] });
    const off = plan(rows, [{ ref: "GL!9", label: "Total", debit: 300_00n, credit: 300_00n }]).checks.find((c) => c.code === "TOTAL_MISMATCH")!;
    expect(off.severity).toBe("REVIEW");
    expect(off.message).toContain('"Total" di file: debit Rp 300, kredit Rp 300; jumlah baris yang terbaca: debit Rp 200, kredit Rp 200.');
    // A subtotal that is not the largest, last in the file: no claim either way.
    expect(codes(plan(rows, [{ ref: "GL!8", label: "Total", debit: 300_00n, credit: 300_00n }, { ref: "GL!9", label: "Total Kas", debit: 50_00n, credit: 0n }]))).not.toContain("TOTAL_MISMATCH");
  });

  it("names a month with no row between the first and the last", () => {
    const p = plan(months([2026, 1], [2026, 3], [2026, 4], [2026, 6]));
    const gap = p.checks.find((c) => c.code === "MISSING_MONTH")!;
    expect(gap.message).toBe("PT Uji: tidak ada baris di Februari 2026, Mei 2026 (file berisi Januari 2026 – Juni 2026). Pastikan bulan itu memang tanpa transaksi, bukan hilang dari file.");
    expect(codes(plan(months([2026, 1], [2026, 2], [2026, 3])))).not.toContain("MISSING_MONTH");
  });

  it("blocks a year typo, offers the one date inside the file's period, and posts there once accepted, keeping the date as written", () => {
    const rows = [...months([2026, 1], [2026, 2], [2026, 3], [2026, 4], [2026, 5], [2026, 6]), ...months([2026, 3], [2026, 4], [2026, 5])];
    const typo = [row(dateOnly(2023, 3, 5), "1101", 70_00n, 0n, { voucher: null }), row(dateOnly(2023, 3, 5), "4100", 0n, 70_00n)];
    const p = plan([...rows, ...typo]);
    const blocks = p.checks.filter((c) => c.code === "DATE_TYPO");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ severity: "BLOCK", acceptable: true, date: dateOnly(2026, 3, 5) });
    expect(blocks[0].message).toMatch(/tanggal 5 Mar 2023 jauh dari periode file \(15 Jan 2026 – 15 Jun 2026\)\. Salah ketik tahun\? Terima untuk mencatatnya per 5 Mar 2026/);
    const fixed = p.entries.find((e) => +e.date === +dateOnly(2026, 3, 5))!;
    expect(fixed.lines.map((l) => l.memo)).toEqual(["tanggal di file 5 Mar 2023", "tanggal di file 5 Mar 2023"]);
    expect(p.entries.some((e) => e.date.getUTCFullYear() === 2023)).toBe(false);
  });

  it("flags a far date with no single fix and posts it as written; leaves a file that truly spans years alone", () => {
    const rows = [...months([2026, 1], [2026, 2], [2026, 3], [2026, 4], [2026, 5], [2026, 6]), ...months([2026, 3], [2026, 4], [2026, 5])];
    const p = plan([...rows, row(dateOnly(2023, 12, 20), "1101", 1n, 0n), row(dateOnly(2023, 12, 20), "4100", 0n, 1n)]);
    expect(p.checks.filter((c) => c.code === "DATE_OUTLIER").map((c) => c.severity)).toEqual(["REVIEW", "REVIEW"]);
    expect(p.entries.some((e) => +e.date === +dateOnly(2023, 12, 20))).toBe(true);
    // Two runs of the same size, years apart: a file that spans them, not a typo.
    const h1 = (y: number) => months(...Array.from({ length: 6 }, (_, i) => [y, i + 1] as [number, number]));
    expect(codes(plan([...h1(2024), ...h1(2026)]))).not.toContain("DATE_OUTLIER");
  });
});
