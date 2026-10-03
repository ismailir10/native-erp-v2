import { describe, expect, it } from "vitest";
import { FormatError, renderFormat, standardFormat, toUnit, validateFormat, type FormatLine, type ReportFormat } from "@/lib/reports/format";
import type { FsItem } from "@/lib/reports/ledger";

/** UC-K3: a client's own report format — presentation only, checked so no line can drop and the results stay right. */
const item = (fsLine: string, amount: bigint, code = "x"): FsItem => ({ fsLine: fsLine as FsItem["fsLine"], label: fsLine, amount, accounts: [{ code, name: code, amount }] });
// A month: revenue 1.000, HPP 600, umum 150, other income 20, other expense −5 (presented negative), tax 50 → net 215.
const IS = [item("PENDAPATAN_USAHA", 1000n), item("HPP", 600n), item("BEBAN_UMUM_ADM", 150n), item("PENDAPATAN_LAIN", 20n), item("BEBAN_LAIN", -5n), item("BEBAN_PAJAK", 50n)];
const totalsOf = (lines: FormatLine[], cols: FsItem[][], unit: ReportFormat["unit"] = "RUPIAH") =>
  Object.fromEntries(renderFormat(lines, cols, unit).flatMap((s) => (s.total ? [[s.total.label, s.total.values]] : [])));

const belifi = (): ReportFormat => {
  const f = standardFormat();
  return {
    ...f,
    source: "Laporan Keuangan 2025 final",
    labaRugi: [
      { key: "jual", kind: "GROUP", label: "PENJUALAN", lines: ["PENDAPATAN_USAHA"] },
      { key: "hpp", kind: "GROUP", label: "HARGA POKOK PENJUALAN", lines: ["HPP"] },
      { key: "kotor", kind: "TOTAL", label: "LABA KOTOR", terms: [{ key: "jual", sign: 1 }, { key: "hpp", sign: -1 }], strong: true, caps: true },
      { key: "h_biaya", kind: "HEADING", label: "BIAYA USAHA" },
      { key: "biaya", kind: "GROUP", label: "Biaya umum, administrasi dan penjualan", lines: ["BEBAN_UMUM_ADM", "BEBAN_PENJUALAN"] },
      { key: "jml_biaya", kind: "TOTAL", label: "JUMLAH BIAYA USAHA", terms: [{ key: "biaya", sign: 1 }], caps: true },
      { key: "usaha", kind: "TOTAL", label: "LABA USAHA", terms: [{ key: "kotor", sign: 1 }, { key: "jml_biaya", sign: -1 }], strong: true },
      { key: "lain", kind: "GROUP", label: "Pendapatan (beban) lain-lain bersih", lines: ["PENDAPATAN_LAIN", "BEBAN_LAIN", "UNMAPPED_INCOME", "UNMAPPED_EXPENSE"] },
      { key: "pajak", kind: "GROUP", label: "Pajak penghasilan", lines: ["BEBAN_PAJAK"] },
      { key: "bersih", kind: "TOTAL", label: "LABA BERSIH", terms: [{ key: "usaha", sign: 1 }, { key: "lain", sign: 1 }, { key: "pajak", sign: -1 }], strong: true },
    ],
  };
};

describe("report format (UC-K3)", () => {
  it("the standard format is valid and renders today's Laba Rugi", () => {
    const f = validateFormat(standardFormat());
    expect(totalsOf(f.labaRugi, [IS])).toEqual({
      "Total pendapatan usaha": [1000n],
      "Laba kotor": [400n],
      "Laba usaha": [250n],
      "Laba sebelum pajak": [265n],
      "Laba bersih": [215n],
    });
    const sections = renderFormat(f.labaRugi, [IS]);
    expect(sections.map((s) => s.title ?? null)).toEqual([null, null, "Beban operasional", "Pendapatan (beban) lain-lain", null]);
  });

  it("a client's own labels, order and JUMLAH rows render, with the same net profit", () => {
    const f = validateFormat(belifi());
    expect(totalsOf(f.labaRugi, [IS])).toEqual({ "LABA KOTOR": [400n], "JUMLAH BIAYA USAHA": [150n], "LABA USAHA": [250n], "LABA BERSIH": [215n] });
    const lain = renderFormat(f.labaRugi, [IS]).flatMap((s) => s.items[0]).find((i) => i.label.startsWith("Pendapatan (beban)"))!;
    expect([lain.amount, lain.accounts.length]).toEqual([15n, 2]);
  });

  it("refuses a format that drops a line, places one twice, sums a later line, or gets the result wrong", () => {
    const drop = belifi();
    drop.labaRugi = drop.labaRugi.filter((l) => l.key !== "pajak").map((l) => (l.key === "bersih" && l.kind === "TOTAL" ? { ...l, terms: l.terms.filter((t) => t.key !== "pajak") } : l));
    expect(() => validateFormat(drop)).toThrow("Laba Rugi: Beban pajak belum ada di format. Setiap pos harus tampil, supaya tidak ada akun yang hilang dari laporan.");
    const twice = belifi();
    twice.labaRugi = twice.labaRugi.map((l) => (l.key === "pajak" && l.kind === "GROUP" ? { ...l, lines: ["BEBAN_PAJAK", "HPP"] } : l));
    expect(() => validateFormat(twice)).toThrow('Laba Rugi: Beban pokok pendapatan ada di dua baris ("HARGA POKOK PENJUALAN" dan "Pajak penghasilan").');
    const later = belifi();
    later.labaRugi = [later.labaRugi[2], ...later.labaRugi.filter((_, i) => i !== 2)];
    expect(() => validateFormat(later)).toThrow('Laba Rugi: total "LABA KOTOR" menjumlahkan baris yang belum ada di atasnya.');
    const wrong = belifi();
    wrong.labaRugi = wrong.labaRugi.map((l) => (l.key === "bersih" && l.kind === "TOTAL" ? { ...l, terms: l.terms.map((t) => (t.key === "pajak" ? { ...t, sign: 1 as const } : t)) } : l));
    expect(() => validateFormat(wrong)).toThrow(/total terakhir harus laba bersih/);
    const noAssets = standardFormat();
    noAssets.neraca = noAssets.neraca.filter((l) => l.key !== "total_aset");
    expect(() => validateFormat(noAssets)).toThrow("Neraca: harus ada total yang sama dengan jumlah semua aset.");
    expect(() => validateFormat({ unit: "DOLLAR" })).toThrow(FormatError);
  });

  it("shows thousands per line, half away from zero, and totals add up the printed lines", () => {
    expect([toUnit(1_499n, "RIBUAN"), toUnit(1_500n, "RIBUAN"), toUnit(-2_500n, "RIBUAN"), toUnit(7n, "RUPIAH")]).toEqual([1n, 2n, -3n, 7n]);
    const thousands = [item("PENDAPATAN_USAHA", 1_000_600n), item("HPP", 400_600n)];
    expect(totalsOf(standardFormat().labaRugi, [thousands], "RIBUAN")["Laba kotor"]).toEqual([600n]);
  });
});
