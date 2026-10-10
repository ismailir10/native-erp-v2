import { describe, expect, it } from "vitest";
import { checkContinuity, repairStatement } from "@/lib/import/normalize";
import { ParseError, type ParsedRow, type ParsedStatement } from "@/lib/import/types";
import { dateOnly } from "@/lib/format";

/** UC-B1: the running balance is the source of truth; a repair is kept only when the whole chain then holds. */
let n = 1;
const row = (d: Date, amount: bigint, balance: bigint | null, extra: Partial<ParsedRow> = {}): ParsedRow => ({ date: d, description: `ROW ${n}`, amount, balance, rowNumber: ++n, rawRow: `raw ${n}`, ...extra });
const statement = (rows: ParsedRow[], opening = 10_000n, closing?: bigint): ParsedStatement => ({
  format: "GENERIC",
  accountNumber: null,
  periodStart: rows.reduce((a, r) => (+r.date < +a ? r.date : a), rows[0].date),
  periodEnd: rows.reduce((a, r) => (+r.date > +a ? r.date : a), rows[0].date),
  openingBalance: opening,
  closingBalance: closing ?? rows.filter((r) => r.balance !== null).at(-1)!.balance!,
  rows,
});
const aug = (d: number) => dateOnly(2026, 8, d);

describe("repairStatement (UC-B1)", () => {
  it("(c) flips a row whose direction the balance contradicts, keeping what the file wrote", () => {
    const st = repairStatement(statement([row(aug(1), 1000n, 11_000n), row(aug(2), 500n, 10_500n), row(aug(3), 2000n, 12_500n)]));
    expect(st.rows.map((r) => r.amount)).toEqual([1000n, -500n, 2000n]);
    expect(st.rows[1].written).toEqual({ amount: 500n });
    expect(st.notes).toEqual([expect.stringMatching(/^Baris \d+: arah dibalik — file menulis masuk Rp 500, tetapi saldo turun sebesar itu/)]);
    expect(checkContinuity(st).ok).toBe(true);
  });

  it("keeps the rows as written when the chain would still not hold (never guess twice)", () => {
    const rows = [row(aug(1), 1000n, 11_000n), row(aug(2), 500n, 10_500n), row(aug(3), 2000n, 99_999n)];
    const st = repairStatement(statement(rows, 10_000n, 99_999n));
    expect(st.rows.map((r) => r.amount)).toEqual([1000n, 500n, 2000n]);
    // Never silent: what the balance suggested but couldn't prove is named.
    expect(st.notes).toEqual([expect.stringMatching(/^Baris \d+: saldo menunjukkan arah kebalikan dari yang tertulis \(masuk Rp 500\); tidak diubah/)]);
    expect(checkContinuity(st).ok).toBe(false);
  });

  it("(x1) takes a balance-only row's amount from the moved balance, and drops one whose balance didn't move", () => {
    const st = repairStatement(statement([row(aug(1), 1000n, 11_000n), row(aug(2), 0n, 10_200n, { balanceOnly: true }), row(aug(2), 0n, 10_200n, { balanceOnly: true }), row(aug(3), 300n, 10_500n)]));
    expect(st.rows.map((r) => [r.amount, r.balanceOnly])).toEqual([[1000n, undefined], [-800n, undefined], [300n, undefined]]);
    expect(st.notes?.[0]).toMatch(/nominal kosong tetapi saldo turun Rp 800; dicatat keluar Rp 800 dari selisih saldo/);
  });

  it("(f) reads a year typo in the statement's year and moves a period taken from it; a far date with no fix refuses the file", () => {
    const rows = [row(dateOnly(2023, 8, 2), 100n, 10_100n), ...[3, 5, 8, 12, 20].map((d, i) => row(aug(d), 100n, 10_200n + BigInt(i) * 100n))];
    const st = repairStatement(statement(rows));
    expect(st.rows[0].date).toEqual(aug(2));
    expect(st.rows[0].written).toEqual({ date: dateOnly(2023, 8, 2) });
    expect([st.periodStart, st.periodEnd]).toEqual([aug(1), aug(20)]);
    expect(st.notes).toEqual([expect.stringMatching(/tanggal 2 Agu 2023 dibaca 2 Agu 2026 \(tahun salah ketik/)]);

    const far = [row(dateOnly(2023, 12, 25), 100n, 10_100n), ...[3, 5, 8, 12, 20].map((d, i) => row(aug(d), 100n, 10_200n + BigInt(i) * 100n))];
    expect(() => repairStatement(statement(far))).toThrow(ParseError);
    expect(() => repairStatement(statement(far))).toThrow(/Tanggal 25 Des 2023 di baris \d+ jauh dari periode file \(3 Agu 2026 – 20 Agu 2026\)/);
  });

  it("preserves a conflicting closing header and says both numbers", () => {
    const st = repairStatement(statement([row(aug(1), 1000n, 11_000n), row(aug(2), 1500n, 12_500n)], 10_000n, 12_000n));
    expect(st.closingBalance).toBe(12_000n);
    expect(st.notes).toEqual(["Saldo akhir di file Rp 12.000 ≠ saldo berjalan Rp 12.500; saldo akhir tercetak dipertahankan. Periksa kedua nilai pada file sumber."]);
    expect(checkContinuity(st).ok).toBe(false);
  });

  it("says both readings of an opening header the first row contradicts", () => {
    const st = statement([row(aug(1), 1000n, 21_000n), row(aug(2), 500n, 21_500n)], 10_000n);
    expect(checkContinuity(repairStatement(st)).note).toBe("Saldo awal di file Rp 10.000 tidak nyambung dengan baris pertama (saldo Rp 21.000 − mutasi Rp 1.000 = Rp 20.000): saldo awal salah tulis, atau ada transaksi sebelum baris pertama yang tidak ada di file");
  });
});
