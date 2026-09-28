import { describe, expect, it } from "vitest";
import { FINANCING_COST, financingSuggestion } from "@/lib/classify/financing";
import { businessDaysApart, matchTransfers } from "@/lib/classify/transfer";

const code = (d: string, dir: "IN" | "OUT") => financingSuggestion(d, dir)?.accountCode ?? null;

describe("financing suggestions", () => {
  it("sends loans, capital and own-money moves to the balance sheet and their costs to the right expense", () => {
    expect(code("PENCAIRAN PINJAMAN KMK", "IN")).toBe("2210");
    expect(code("ANGSURAN POKOK PINJAMAN KI 08/26", "OUT")).toBe("2210");
    expect(code("BUNGA PINJAMAN KMK", "OUT")).toBe("7110");
    expect(code("BIAYA PROVISI PLAFON KREDIT", "OUT")).toBe("7100");
    expect(code("SETORAN MODAL PEMEGANG SAHAM", "IN")).toBe("3100");
    expect(code("PENCAIRAN PINJAMAN MODAL KERJA", "IN")).toBe("2210"); // working-capital loan, not equity
    expect(code("PENCAIRAN KREDIT KMK 08/26", "IN")).toBe("2210");
    expect(code("PELUNASAN KREDIT INVESTASI", "OUT")).toBe("2210");
    expect(code("PELUNASAN PRK 08/26", "OUT")).toBe("2210"); // the same loan words both ways
    expect(code("PELUNASAN PLAFON KREDIT", "OUT")).toBe("2210");
    expect(code("PINDAH BUKU KE REK 123", "OUT")).toBe("1199");
    expect(financingSuggestion("PENCAIRAN PINJAMAN KMK", "IN")).toMatchObject({ method: "HEURISTIC", confidence: 0.5, taxTag: null });
  });

  it("never suggests a P&L account the sanity control would then flag as financing in Laba Rugi", () => {
    for (const d of ["BUNGA PINJAMAN KMK", "BIAYA PROVISI PLAFON KREDIT", "PROVISI PINJAMAN", "ADM PINJAMAN KMK", "MATERAI PERJANJIAN KREDIT KMK"]) {
      const s = financingSuggestion(d, "OUT");
      expect(s && ["7100", "7110"].includes(s.accountCode) ? FINANCING_COST.test(d) : true).toBe(true);
    }
  });

  it("never books a cost on a loan (a tax, say) as principal", () => {
    for (const d of ["PAJAK PINJAMAN", "PAJAK BUNGA PINJAMAN KMK", "TAX ON LOAN", "PPH PAJAK PELUNASAN KREDIT KMK"]) {
      for (const dir of ["IN", "OUT"] as const) {
        const s = financingSuggestion(d, dir);
        expect(s === null || ["7100", "7110"].includes(s.accountCode)).toBe(true);
      }
    }
    expect(code("PAJAK PINJAMAN", "OUT")).toBeNull();
  });

  it("stays out of ordinary lines and of combinations it can't read", () => {
    expect(code("TRSF E-BANKING CR PT MITRA UNGGAS", "IN")).toBeNull();
    expect(code("BUNGA JASA GIRO", "IN")).toBeNull(); // interest income, no financing word
    expect(code("BUNGA PINJAMAN", "IN")).toBeNull();
    expect(code("PENEMPATAN DEPOSITO", "OUT")).toBeNull(); // no template account for deposits
    expect(code("PELUNASAN INV 2026-0815 PT MITRA", "OUT")).toBeNull(); // settling an invoice is not a loan
    expect(code("PENCAIRAN DEPOSITO", "IN")).toBeNull();
  });
});

describe("transfer window in business days", () => {
  const day = (s: string) => new Date(`${s}T00:00:00Z`);
  it("counts weekdays only", () => {
    expect(businessDaysApart(day("2026-08-14"), day("2026-08-18"))).toBe(2); // Fri → Tue
    expect(businessDaysApart(day("2026-08-18"), day("2026-08-14"))).toBe(2);
    expect(businessDaysApart(day("2026-08-10"), day("2026-08-14"))).toBe(4); // Mon → Fri
    expect(businessDaysApart(day("2026-08-15"), day("2026-08-17"))).toBe(1); // Sat → Mon
  });

  it("pairs a Friday transfer that lands on Tuesday, not one four business days apart", () => {
    const own = [{ entityId: "pt", names: ["PT UJI SEJAHTERA"] }];
    const item = (id: string, bank: string, date: string, amount: bigint) => ({ id, entityId: "pt", bankAccountId: bank, date: day(date), description: "TRSF E-BANKING PINDAH DANA", merchantKey: "", direction: (amount < 0n ? "OUT" : "IN") as "IN" | "OUT", amount });
    const r = matchTransfers([item("out", "bca", "2026-08-14", -5_000_000n), item("in", "mandiri", "2026-08-18", 5_000_000n)], own);
    expect(r.get("out")?.matchedTxId).toBe("in");
    const far = matchTransfers([item("out", "bca", "2026-08-10", -5_000_000n), item("in", "mandiri", "2026-08-14", 5_000_000n)], own);
    expect(far.get("out")?.matchedTxId).toBeUndefined();
  });
});
