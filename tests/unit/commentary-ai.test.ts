import { describe, expect, it } from "vitest";
import { allowedNumbers, foreignNumbers, numberTokens } from "@/lib/reports/commentary-ai";

const facts = [
  "Pendapatan Agustus 2026 Rp 1.505.720.721, naik Rp 69.594.595 (4,8 %) dari Juli 2026.",
  "Laba bersih bulan ini Rp 170.000.000, margin bersih 11,3 %.",
  "5100 Pembelian Pakan: Rp 9.500.000 bulan ini, lebih tinggi Rp 2.000.000 dari rata-rata bulan sebelumnya (Rp 7.500.000).",
];

describe("number check on an AI draft", () => {
  it("reads number tokens as Bahasa copy writes them", () => {
    expect(numberTokens("Naik Rp 69.594.595 (4,8 %), Agustus 2026.")).toEqual(["69.594.595", "4,8", "2026"]);
    expect(numberTokens("tanpa angka")).toEqual([]);
  });

  it("passes a draft that only reorders and rewords the computed numbers", () => {
    const draft = "Agustus 2026 berjalan baik: pendapatan Rp 1.505.720.721, naik 4,8 % (Rp 69.594.595). Laba bersih Rp 170.000.000 atau 11,3 % dari pendapatan; akun 5100 lebih tinggi Rp 2.000.000.";
    expect(foreignNumbers(draft, allowedNumbers(facts))).toEqual([]);
  });

  it("names every invented, rounded or converted number", () => {
    const draft = "Pendapatan sekitar Rp 1,5 miliar, naik 5 % dari Juli; laba Rp 170.000.000, target 2027 Rp 2.000.000.000.";
    expect(foreignNumbers(draft, allowedNumbers(facts))).toEqual(["1,5", "5", "2027", "2.000.000.000"]);
  });
});
