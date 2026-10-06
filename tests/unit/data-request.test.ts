import { describe, expect, it } from "vitest";
import { dataRequest, monthRanges } from "@/lib/controls/data-request";
import type { CompletenessCell, CompletenessRow } from "@/lib/controls/completeness";

const cell = (year: number, month: number, state: CompletenessCell["state"], diff: bigint | null = null): CompletenessCell => ({ year, month, state, diff, note: null });
const bank = (cells: CompletenessCell[]): CompletenessRow => ({ kind: "bank", bankAccountId: "b1", entity: "PT Uji", label: "BCA Giro", currency: "IDR", cells });

describe("monthRanges", () => {
  it("groups consecutive months, across a year end too", () => {
    expect(monthRanges([{ year: 2026, month: 4 }, { year: 2026, month: 5 }, { year: 2026, month: 7 }])).toEqual(["April–Mei 2026", "Juli 2026"]);
    expect(monthRanges([{ year: 2025, month: 12 }, { year: 2026, month: 1 }])).toEqual(["Desember 2025–Januari 2026"]);
    expect(monthRanges([])).toEqual([]);
  });
});

describe("dataRequest", () => {
  const base = { clientName: "PT Contoh Sejahtera", firmName: "KJA Demo & Rekan", period: { year: 2026, month: 8 } };

  it("lists missing months as ranges, broken months with their difference, and the ledger export", () => {
    const text = dataRequest({
      ...base,
      rows: [
        bank([cell(2026, 4, "missing"), cell(2026, 5, "missing"), cell(2026, 6, "broken", -2_150_000n), cell(2026, 7, "ok"), cell(2026, 8, "missing")]),
        { ...bank([cell(2026, 7, "broken")]), bankAccountId: "b2", label: "Mandiri Giro" },
        { kind: "ledger", bankAccountId: "ledger", entity: "Ekspor sistem akuntansi", label: "Buku besar (file)", currency: "IDR", cells: [cell(2026, 7, "ok"), cell(2026, 8, "missing")] },
      ],
    })!.text;
    expect(text).toContain("Untuk pembukuan PT Contoh Sejahtera sampai Agustus 2026, kami masih memerlukan:");
    expect(text).toContain("1. Rekening koran BCA Giro a.n. PT Uji: April–Mei 2026 dan Agustus 2026.");
    expect(text).toContain("2. Rekening koran BCA Giro a.n. PT Uji, Juni 2026: saldo awalnya tidak sama dengan saldo akhir bulan sebelumnya (selisih Rp 2.150.000).");
    expect(text).toContain("3. Rekening koran Mandiri Giro a.n. PT Uji, Juli 2026: saldo berjalan di file tidak nyambung.");
    expect(text).toContain("4. Ekspor buku besar dari sistem akuntansi: Agustus 2026.");
    expect(text).toMatch(/bukan foto/);
    expect(text.trim().endsWith("KJA Demo & Rekan")).toBe(true);
  });

  it("asks about unclear transactions too, largest first, up to ten, and counts what it asks", () => {
    const q = (i: number, amount: bigint) => ({ date: new Date(Date.UTC(2026, 7, i)), entity: "PT Uji", bank: "BCA Giro", description: `TRSF ${i}`, amount, currency: "IDR", suggestion: null });
    const only = dataRequest({ ...base, rows: [], questions: [q(5, -4_250_000n), q(6, 12_500_000n)] })!;
    expect(only.items).toBe(2);
    expect(only.text).toContain("Untuk pembukuan PT Contoh Sejahtera sampai Agustus 2026, mohon penjelasan transaksi berikut: dari/ke siapa dan untuk apa.");
    expect(only.text).toContain("a. 5 Agu 2026 · BCA Giro · TRSF 5 · keluar Rp 4.250.000");
    expect(only.text).toContain("b. 6 Agu 2026 · BCA Giro · TRSF 6 · masuk Rp 12.500.000");
    const many = dataRequest({ ...base, rows: [bank([cell(2026, 8, "missing")])], questions: Array.from({ length: 12 }, (_, i) => q(i + 1, -1000n)) })!;
    expect(many.items).toBe(13);
    expect(many.text).toContain("Mohon juga penjelasan transaksi berikut");
    expect(many.text).toContain("j. 10 Agu 2026");
    expect(many.text).not.toContain("k. ");
    expect(many.text).toContain("…dan 2 transaksi lain; daftar lengkapnya kami kirim dalam file Excel.");
  });

  it("is null when nothing is missing", () => {
    expect(dataRequest({ ...base, rows: [bank([cell(2026, 7, "ok"), cell(2026, 8, "before")])] })).toBeNull();
    expect(dataRequest({ ...base, rows: [] })).toBeNull();
    expect(dataRequest({ ...base, rows: [], questions: [] })).toBeNull();
  });
});
