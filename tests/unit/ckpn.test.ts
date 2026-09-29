import { describe, expect, it } from "vitest";
import { agingAt, allowance, lossRates, manualRates, monthEnds, rollRates, DEFAULT_SETTING, type LedgerInvoice } from "@/lib/receivables/ckpn";
import { dateOnly, percentToBp } from "@/lib/format";

const d = (m: number, day: number) => dateOnly(2026, m, day);
const inv = (id: string, issue: Date, due: Date, total: bigint, settlements: [Date, bigint][] = []): LedgerInvoice => ({ id, issueDate: issue, dueDate: due, total, settlements: settlements.map(([date, amount]) => ({ date, amount })) });

describe("CKPN matrix (PSAK 109)", () => {
  it("rolls invoice by invoice between month-ends, counting only what could age", () => {
    const ends = [d(1, 31), d(2, 28), d(3, 31)];
    const invoices = [
      // 1–30 at Jan (11 days), 31–60 at Feb: 60 of 100 paid → 40 % rolled; at Mar in 61–90 still 40 open → 100 %.
      inv("A", d(1, 1), d(1, 20), 100n, [[d(2, 10), 60n]]),
      // Current at Jan, 1–30 at Feb, paid in full before → 0 % rolled.
      inv("B", d(1, 1), d(2, 15), 200n, [[d(2, 20), 200n]]),
      // Issued in Feb: current at Feb, 1–30 at Mar, unpaid → 100 %.
      inv("C", d(2, 1), d(3, 20), 100n),
      // Current at Jan and still current at Feb (due 30 Mar): no chance to roll in Jan→Feb; rolls in Feb→Mar, unpaid.
      inv("D", d(1, 5), d(3, 30), 50n),
    ];
    const rolls = rollRates(invoices, ends);
    expect(rolls.map((r) => [r.from, r.ppm, r.samples])).toEqual([
      ["CURRENT", 500_000n, 2], // (0 % + 100 %) / 2
      ["D1_30", 400_000n, 1],
      ["D31_60", 1_000_000n, 1],
      ["D61_90", null, 0],
    ]);
    expect(agingAt(invoices, d(3, 31))).toEqual({ CURRENT: 0n, D1_30: 150n, D31_60: 0n, D61_90: 40n, OVER_90: 0n });
  });

  it("skips what was paid by the month-end and averages half up", () => {
    const r = rollRates([inv("X", d(1, 1), d(1, 20), 100n, [[d(1, 25), 100n]])], [d(1, 31), d(2, 28)]);
    expect(r[1].samples).toBe(0); // fully paid at Jan end: nothing open to roll
    const y = rollRates([inv("Y", d(1, 1), d(1, 20), 300n, [[d(2, 5), 200n]]), inv("Z", d(2, 1), d(2, 10), 3n, [[d(3, 1), 1n]])], [d(1, 31), d(2, 28), d(3, 31)]);
    // Jan→Feb 1/3 = 333 333.33 → 333 333; Feb→Mar Z 2/3 = 666 666.67 → 666 667; average 500 000.
    expect(y[1]).toMatchObject({ from: "D1_30", ppm: 500_000n, samples: 2 });
  });

  it("chains loss rates from the last bucket; zero stops the chain, unknown propagates", () => {
    expect(lossRates([500_000n, 400_000n, 500_000n, 800_000n], 1_000_000n)).toEqual([80_000n, 160_000n, 400_000n, 800_000n, 1_000_000n]);
    expect(lossRates([0n, 400_000n, null, 800_000n], 1_000_000n)).toEqual([0n, null, null, 800_000n, 1_000_000n]);
    expect(lossRates([500_000n, 400_000n, 500_000n, 800_000n], 500_000n)[0]).toBe(40_000n);
  });

  it("multiplies open × loss rate × forward-looking factor, half up per bucket", () => {
    const open = { CURRENT: 1_000_000n, D1_30: 500_000n, D31_60: 0n, D61_90: 3n, OVER_90: 250_000n };
    expect(allowance(open, [80_000n, 160_000n, 400_000n, 800_000n, 1_000_000n], 10_000)).toEqual([80_000n, 80_000n, 0n, 2n, 250_000n]);
    // 110 %: 88 000, 88 000, 0, 3 × 0,8 × 1,1 = 2,64 → 3, 275 000.
    expect(allowance(open, [80_000n, 160_000n, 400_000n, 800_000n, 1_000_000n], 11_000)).toEqual([88_000n, 88_000n, 0n, 3n, 275_000n]);
    // Unknown rate: null only where something is open.
    expect(allowance(open, [null, 160_000n, null, 800_000n, 1_000_000n], 10_000)).toEqual([null, 80_000n, 0n, 2n, 250_000n]);
  });

  it("takes manual rates in basis points, parses percents, lists month-ends", () => {
    expect(manualRates({ ...DEFAULT_SETTING, currentBp: 150, d1to30Bp: 500, d31to60Bp: 2_000, d61to90Bp: 5_000 })).toEqual([15_000n, 50_000n, 200_000n, 500_000n, 1_000_000n]);
    expect([percentToBp("2,5"), percentToBp("2.55"), percentToBp("100"), percentToBp("12 %"), percentToBp("1,234"), percentToBp("-1"), percentToBp("")]).toEqual([250, 255, 10_000, 1_200, null, null, null]);
    expect(monthEnds(2026, 2, 3).map((x) => x.toISOString().slice(0, 10))).toEqual(["2025-11-30", "2025-12-31", "2026-01-31", "2026-02-28"]);
  });
});
