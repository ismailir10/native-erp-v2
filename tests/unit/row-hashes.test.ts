import { describe, expect, it } from "vitest";
import { rowHash, rowHashes } from "@/lib/import/normalize";
import type { ParsedRow } from "@/lib/import/types";

const row = (description: string, amount: bigint, balance: bigint | null = null, day = 2): ParsedRow => ({ date: new Date(Date.UTC(2026, 7, day)), description, amount, balance, rowNumber: 1, rawRow: description });

describe("rowHashes", () => {
  it("the first of a kind keeps its plain hash, so lines imported before still match", () => {
    const a = row("BIAYA ADM", -15_000n);
    expect(rowHashes([a, row("TRSF", 1_000n)])[0]).toBe(rowHash(a));
  });

  it("identical rows get distinct, deterministic hashes", () => {
    const a = row("BIAYA ADM", -15_000n);
    const first = rowHashes([a, a, a]);
    expect(new Set(first).size).toBe(3);
    expect(rowHashes([a, a, a])).toEqual(first);
    expect(first[1]).not.toBe(rowHash(a));
  });

  it("rows that differ (date, amount, description or balance) are untouched", () => {
    const rows = [row("BIAYA ADM", -15_000n), row("BIAYA ADM", -15_000n, null, 3), row("BIAYA ADM", -16_000n), row("BIAYA LAIN", -15_000n), row("BIAYA ADM", -15_000n, 99n)];
    expect(rowHashes(rows)).toEqual(rows.map(rowHash));
  });
});
